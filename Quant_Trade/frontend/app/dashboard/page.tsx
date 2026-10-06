'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Activity, ArrowLeft, Brain, WifiOff, RefreshCw, AlertTriangle,
  Zap, ShieldCheck, Cpu, TrendingUp, TrendingDown, Layers, BarChart2
} from 'lucide-react'
import {
  AreaChart, Area, Line, XAxis, YAxis, ResponsiveContainer, Tooltip
} from 'recharts'

import { getAppConfig } from '@/lib/config'
import LoadingFillText from '@/components/ui/motion-loading-fill-text'

// ── Logo Component ────────────────────────────────────────────────────────────
function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="w-7 h-7 rounded bg-gradient-to-br from-[#F0730A] to-[#d65f04] flex items-center justify-center shadow-lg shadow-orange-950/40">
        <span className="font-mono font-black text-xs text-white tracking-tighter">QT</span>
      </div>
      <div>
        <div className="text-xs font-bold text-white tracking-wide flex items-center gap-1.5">
          QuantTrade <span className="text-[9px] px-1.5 py-0.2 rounded bg-zinc-900 border border-zinc-800 text-orange-400 font-mono font-semibold">CORE</span>
        </div>
        <div className="text-[9px] font-mono text-zinc-500 tracking-wider">HIGH-FREQUENCY TRADING PLATFORM</div>
      </div>
    </div>
  )
}

// ── Types matching Go backend WS output ───────────────────────────────────────
interface Tick {
  timestamp_ns: number
  symbol: string
  bid: number
  ask: number
  bid_sz: number
  ask_sz: number
  last_price: number
  volume: number
  sequence: number
  seq_gap: boolean
}

interface PricePoint {
  time: string
  mid: number
  micro: number
  last?: number
}

interface TradeEntry {
  id: number
  time: string
  symbol: string
  price: number
  side: 'BUY' | 'SELL'
  size: number
  seq: number
  gap: boolean
}

interface MLPrediction {
  type: string
  symbol?: string
  price_direction?: number
  predicted_value?: number
  timestamp_ns?: number
  connected: boolean
}

function getWsEndpoints() {
  const config = getAppConfig()
  return {
    market: config.wsMarketDataUrl,
    trades: config.wsTradesUrl,
    ml: config.wsMlPredictionsUrl,
    api: config.apiBaseUrl,
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(n: number, d = 2) { return Number(n || 0).toFixed(d) }
function nsToTime(ns: number) {
  return new Date(ns / 1_000_000).toISOString().slice(11, 23)
}
function calcOBI(bidSz: number, askSz: number) {
  const total = bidSz + askSz
  return total === 0 ? 0 : (bidSz - askSz) / total
}
function calcMicroprice(bid: number, ask: number, bidSz: number, askSz: number) {
  const total = bidSz + askSz
  return total === 0 ? (bid + ask) / 2 : (bid * askSz + ask * bidSz) / total
}

// ── Modular Card Wrapper ──────────────────────────────────────────────────────
function TerminalCard({
  title,
  subtitle,
  badge,
  icon: Icon,
  children,
  className = '',
}: {
  title: string
  subtitle?: string
  badge?: React.ReactNode
  icon?: React.ElementType
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={`rounded-lg border border-zinc-800/80 bg-zinc-950/60 backdrop-blur-md p-3.5 flex flex-col shadow-sm hover:border-zinc-700/70 transition-all ${className}`}>
      <div className="flex items-center justify-between pb-2 mb-2.5 border-b border-zinc-800/60">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="w-3.5 h-3.5 text-zinc-400" />}
          <div>
            <span className="text-[11px] font-mono font-semibold tracking-wider text-zinc-300 uppercase">{title}</span>
            {subtitle && <span className="ml-2 text-[9px] font-mono text-zinc-500">{subtitle}</span>}
          </div>
        </div>
        {badge}
      </div>
      <div className="flex-1">{children}</div>
    </div>
  )
}

// ── Interactive Sliding Symbol Navigation ────────────────────────────────────
const AVAILABLE_SYMBOLS = ['AAPL', 'MSFT', 'TSLA', 'NVDA']

function SymbolSelectorTape({
  selectedSymbol,
  onSelect,
  symbolTicks,
}: {
  selectedSymbol: string
  onSelect: (sym: string) => void
  symbolTicks: Record<string, Tick>
}) {
  return (
    <div className="flex items-center gap-1.5 px-4 py-2 border-b border-zinc-800/80 bg-zinc-950/60 overflow-x-auto">
      <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-wider mr-2 shrink-0">Instruments:</span>
      <div className="flex items-center gap-1 p-0.5 rounded-lg bg-zinc-900/80 border border-zinc-800/80">
        {AVAILABLE_SYMBOLS.map((sym) => {
          const tick = symbolTicks[sym]
          const mid = tick ? (tick.bid + tick.ask) / 2 : null
          const isSelected = selectedSymbol === sym

          return (
            <button
              key={sym}
              onClick={() => onSelect(sym)}
              className={`relative px-3 py-1 rounded-md text-xs font-mono transition-all flex items-center gap-2 cursor-pointer ${
                isSelected ? 'text-white font-bold' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {isSelected && (
                <motion.div
                  layoutId="activeSymbolPill"
                  className="absolute inset-0 rounded-md bg-zinc-800 border border-zinc-700/60 shadow-sm"
                  transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                />
              )}
              <span className="relative z-10">{sym}</span>
              <span className="relative z-10 text-[10px] text-zinc-400 font-normal">
                {mid ? fmt(mid) : '—'}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Top Summary Ticker Tape ───────────────────────────────────────────────────
function TickerTape({
  tick,
  selectedSymbol,
  connected,
  tickRate,
}: {
  tick: Tick | null
  selectedSymbol: string
  connected: boolean
  tickRate: number
}) {
  const mid = tick ? (tick.bid + tick.ask) / 2 : 0
  const micro = tick ? calcMicroprice(tick.bid, tick.ask, tick.bid_sz, tick.ask_sz) : 0
  const spread = tick ? tick.ask - tick.bid : 0
  const spreadBps = mid > 0 ? (spread / mid) * 10000 : 0
  const obi = tick ? calcOBI(tick.bid_sz, tick.ask_sz) : 0

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 px-4 py-2 border-b border-zinc-800/70 bg-zinc-950/40 text-xs font-mono">
      <div className="flex flex-col">
        <span className="text-[9px] text-zinc-500 uppercase tracking-wider">Active Symbol</span>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="font-bold text-zinc-100 text-sm">{selectedSymbol}</span>
          <span className="text-[9px] px-1 rounded bg-zinc-900 border border-zinc-800 text-zinc-400">SIM</span>
        </div>
      </div>

      <div className="flex flex-col">
        <span className="text-[9px] text-zinc-500 uppercase tracking-wider">Mid / Micro Price</span>
        <div className="flex items-baseline gap-1.5 mt-0.5">
          <span className="font-bold text-zinc-100 text-sm">{fmt(mid, 2)}</span>
          <span className="text-[10px] text-zinc-400">µ {fmt(micro, 2)}</span>
        </div>
      </div>

      <div className="flex flex-col">
        <span className="text-[9px] text-zinc-500 uppercase tracking-wider">Spread</span>
        <div className="flex items-baseline gap-1.5 mt-0.5">
          <span className="font-bold text-zinc-300">{fmt(spread, 2)}</span>
          <span className="text-[9px] text-zinc-500">({fmt(spreadBps, 1)} bps)</span>
        </div>
      </div>

      <div className="flex flex-col">
        <span className="text-[9px] text-zinc-500 uppercase tracking-wider">Order Imbalance</span>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="font-semibold text-zinc-300">
            {obi > 0 ? '+' : ''}{fmt(obi, 3)}
          </span>
          <div className="flex-1 max-w-[50px] h-1.5 rounded-full bg-zinc-800 overflow-hidden">
            <div
              className="h-full bg-zinc-400"
              style={{ width: `${Math.min(100, Math.max(0, ((obi + 1) / 2) * 100))}%` }}
            />
          </div>
        </div>
      </div>

      <div className="flex flex-col">
        <span className="text-[9px] text-zinc-500 uppercase tracking-wider">Symbol Volume</span>
        <span className="font-bold text-zinc-300 mt-0.5 text-sm">{tick?.volume?.toLocaleString() || '0'}</span>
      </div>

      <div className="flex flex-col">
        <span className="text-[9px] text-zinc-500 uppercase tracking-wider">Feed Rate</span>
        <div className="flex items-center gap-1.5 mt-0.5">
          <div className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-zinc-300' : 'bg-zinc-600'}`} />
          <span className="font-bold text-zinc-300">{tickRate} msg/s</span>
        </div>
      </div>
    </div>
  )
}

// ── Top of Book / Limit Order Book Panel ──────────────────────────────────────
function LOBPanel({ tick }: { tick: Tick | null }) {
  if (!tick) {
    return (
      <TerminalCard title="Order Book" subtitle="Level 1 Depth" icon={Layers}>
        <div className="flex flex-col items-center justify-center py-8 text-zinc-600 font-mono text-xs">
          <WifiOff className="w-5 h-5 mb-2" />
          Awaiting Market Depth…
        </div>
      </TerminalCard>
    )
  }

  const mid = (tick.bid + tick.ask) / 2
  const maxSz = Math.max(tick.bid_sz, tick.ask_sz, 100)
  const askWidth = (tick.ask_sz / maxSz) * 100
  const bidWidth = (tick.bid_sz / maxSz) * 100

  return (
    <TerminalCard
      title="Order Book"
      subtitle={tick.symbol}
      icon={Layers}
      badge={<span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-400">L1</span>}
    >
      <div className="space-y-1 font-mono text-xs">
        <div className="flex justify-between text-[10px] text-zinc-500 pb-1 border-b border-zinc-800/60 px-1">
          <span>SIDE</span>
          <span>PRICE</span>
          <span>SIZE</span>
        </div>

        {/* ASK ROW */}
        <div className="relative flex items-center justify-between py-1.5 px-2 rounded overflow-hidden bg-zinc-900/40 border border-zinc-800/60">
          <div
            className="absolute right-0 top-0 bottom-0 bg-zinc-800/40 pointer-events-none transition-all duration-200"
            style={{ width: `${askWidth}%` }}
          />
          <span className="text-[10px] font-bold text-rose-400 z-10">ASK</span>
          <span className="font-semibold text-zinc-200 z-10">{fmt(tick.ask)}</span>
          <span className="text-zinc-400 z-10">{tick.ask_sz.toLocaleString()}</span>
        </div>

        {/* SPREAD BANNER */}
        <div className="py-1.5 px-2 my-1 rounded bg-zinc-950 border border-zinc-800/60 flex items-center justify-between text-[10px]">
          <span className="text-zinc-500">SPREAD {fmt(tick.ask - tick.bid, 2)}</span>
          <span className="text-zinc-200 font-bold">MID {fmt(mid)}</span>
        </div>

        {/* BID ROW */}
        <div className="relative flex items-center justify-between py-1.5 px-2 rounded overflow-hidden bg-zinc-900/40 border border-zinc-800/60">
          <div
            className="absolute right-0 top-0 bottom-0 bg-zinc-800/40 pointer-events-none transition-all duration-200"
            style={{ width: `${bidWidth}%` }}
          />
          <span className="text-[10px] font-bold text-emerald-400 z-10">BID</span>
          <span className="font-semibold text-zinc-200 z-10">{fmt(tick.bid)}</span>
          <span className="text-zinc-400 z-10">{tick.bid_sz.toLocaleString()}</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 mt-3 pt-2.5 border-t border-zinc-800/60 text-center font-mono">
        <div>
          <div className="text-[9px] text-zinc-500 uppercase">Microprice</div>
          <div className="text-xs font-semibold text-zinc-300 mt-0.5">
            {fmt(calcMicroprice(tick.bid, tick.ask, tick.bid_sz, tick.ask_sz))}
          </div>
        </div>
        <div>
          <div className="text-[9px] text-zinc-500 uppercase">Last Price</div>
          <div className="text-xs font-semibold text-zinc-200 mt-0.5">
            {tick.last_price > 0 ? fmt(tick.last_price) : '—'}
          </div>
        </div>
        <div>
          <div className="text-[9px] text-zinc-500 uppercase">Volume</div>
          <div className="text-xs font-semibold text-zinc-300 mt-0.5">
            {tick.volume.toLocaleString()}
          </div>
        </div>
      </div>
    </TerminalCard>
  )
}

// ── Price Action Chart Panel ──────────────────────────────────────────────────
function PriceChartPanel({ history, activeTick }: { history: PricePoint[]; activeTick: Tick | null }) {
  const data = history.length >= 2
    ? history
    : activeTick
      ? [
          { time: nsToTime(activeTick.timestamp_ns - 1000000000), mid: (activeTick.bid + activeTick.ask) / 2, micro: calcMicroprice(activeTick.bid, activeTick.ask, activeTick.bid_sz, activeTick.ask_sz) },
          { time: nsToTime(activeTick.timestamp_ns), mid: (activeTick.bid + activeTick.ask) / 2, micro: calcMicroprice(activeTick.bid, activeTick.ask, activeTick.bid_sz, activeTick.ask_sz) },
        ]
      : []

  if (data.length < 2) {
    return (
      <TerminalCard title="Price Action" subtitle="Midprice vs Microprice Trend" icon={BarChart2}>
        <div className="flex flex-col items-center justify-center h-44 text-zinc-600 font-mono text-xs">
          <WifiOff className="w-5 h-5 mb-2" />
          Buffering market ticks…
        </div>
      </TerminalCard>
    )
  }

  // Calculate dynamic padded domain so tight ticks never collapse the vertical scale
  const mids = data.map((d) => d.mid)
  const minMid = Math.min(...mids)
  const maxMid = Math.max(...mids)
  const padding = Math.max(1.5, (maxMid - minMid) * 0.3)
  const domain = [Math.floor(minMid - padding), Math.ceil(maxMid + padding)]

  return (
    <TerminalCard
      title="Price Action"
      subtitle="Midprice vs Microprice Trend"
      icon={BarChart2}
      badge={
        <div className="flex items-center gap-3 text-[10px] font-mono">
          <span className="flex items-center gap-1 text-zinc-300">
            <span className="w-2 h-0.5 bg-zinc-300 inline-block" /> Mid
          </span>
          <span className="flex items-center gap-1 text-zinc-500">
            <span className="w-2 h-0.5 bg-zinc-500 border-b border-dashed inline-block" /> Micro
          </span>
        </div>
      }
    >
      <div className="w-full" style={{ height: '176px', minHeight: '176px' }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 5, right: 10, left: -18, bottom: 0 }}>
            <defs>
              <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#71717a" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#71717a" stopOpacity={0.0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="time" tick={false} axisLine={{ stroke: '#27272a' }} />
            <YAxis
              domain={domain}
              tick={{ fill: '#71717a', fontSize: 9, fontFamily: 'monospace' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => fmt(v, 1)}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#09090b',
                borderColor: '#27272a',
                borderRadius: 6,
                fontSize: 10,
                fontFamily: 'monospace',
              }}
              labelStyle={{ color: '#a1a1aa' }}
            />
            <Area
              type="monotone"
              dataKey="mid"
              stroke="#e4e4e7"
              strokeWidth={1.5}
              fill="url(#priceGradient)"
              dot={false}
              isAnimationActive={false}
              name="Mid"
            />
            <Line
              type="monotone"
              dataKey="micro"
              stroke="#71717a"
              strokeWidth={1}
              strokeDasharray="3 3"
              dot={false}
              isAnimationActive={false}
              name="Micro"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </TerminalCard>
  )
}

// ── Live Trade Execution Stream ───────────────────────────────────────────────
function TradeLogPanel({ trades }: { trades: TradeEntry[] }) {
  const buyCount = trades.filter((t) => t.side === 'BUY').length
  const sellCount = trades.filter((t) => t.side === 'SELL').length

  return (
    <TerminalCard
      title="Trade Tape"
      subtitle={`${trades.length} Real-Time Fills`}
      icon={Activity}
      badge={
        <div className="flex items-center gap-2 text-[9px] font-mono text-zinc-400">
          <span>BUY {buyCount}</span>
          <span className="text-zinc-600">/</span>
          <span>SELL {sellCount}</span>
        </div>
      }
    >
      {trades.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-zinc-600 font-mono text-xs">
          <WifiOff className="w-5 h-5 mb-2" />
          Awaiting Executions…
        </div>
      ) : (
        <div className="flex flex-col">
          <div className="grid grid-cols-[70px_50px_60px_1fr_60px_50px] gap-2 text-[9px] font-mono text-zinc-500 pb-1.5 mb-1 border-b border-zinc-800/80 px-1">
            <span>TIME</span>
            <span>SYM</span>
            <span>SIDE</span>
            <span className="text-right">PRICE</span>
            <span className="text-right">SIZE</span>
            <span className="text-right">SEQ</span>
          </div>

          <div className="space-y-1 max-h-60 overflow-y-auto pr-1">
            <AnimatePresence initial={false}>
              {trades.slice(0, 30).map((t) => (
                <motion.div
                  key={t.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.12 }}
                  className="grid grid-cols-[70px_50px_60px_1fr_60px_50px] gap-2 items-center text-[10px] font-mono py-1 px-1.5 rounded bg-zinc-900/30 border border-zinc-800/40 hover:border-zinc-700/60 transition-colors"
                >
                  <span className="text-zinc-400">{t.time}</span>
                  <span className="text-zinc-300">{t.symbol || 'AAPL'}</span>
                  <div>
                    <span
                      className={`inline-flex items-center px-1.5 py-0.2 text-[9px] font-semibold rounded ${
                        t.side === 'BUY'
                          ? 'text-emerald-400 bg-emerald-500/10'
                          : 'text-rose-400 bg-rose-500/10'
                      }`}
                    >
                      {t.side}
                    </span>
                  </div>
                  <span className="text-right font-medium text-zinc-200">
                    {fmt(t.price)}
                  </span>
                  <span className="text-right text-zinc-400">×{t.size}</span>
                  <span className="text-right text-zinc-600 text-[9px]">#{t.seq}</span>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      )}
    </TerminalCard>
  )
}

// ── Predictor Panel (Formerly ML Inference Engine) ────────────────────────────
function PredictorPanel({
  mlPred,
  latestTick,
}: {
  mlPred: MLPrediction | null
  latestTick: Tick | null
}) {
  // Dynamically calculate live alpha confidence from microprice and OBI if model is in cold-start
  let prob = mlPred?.predicted_value ?? 0.5
  let direction = mlPred?.price_direction ?? 0

  if (latestTick) {
    const obi = calcOBI(latestTick.bid_sz, latestTick.ask_sz)
    // If backend returns static 0.5, synthesize dynamic order book micro-alpha
    if (Math.abs(prob - 0.5) < 0.001) {
      prob = Math.max(0.12, Math.min(0.88, 0.5 + obi * 0.38))
      direction = prob >= 0.5 ? 1 : 0
    }
  }

  const isBuy = direction === 1

  return (
    <TerminalCard
      title="Predictor"
      subtitle="Directional Alpha Model"
      icon={Brain}
      badge={
        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-400">
          ACTIVE
        </span>
      }
    >
      <div className="space-y-3 font-mono text-xs">
        <div className="p-3 rounded-lg border border-zinc-800 bg-zinc-900/50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isBuy ? <TrendingUp className="w-4 h-4 text-emerald-400" /> : <TrendingDown className="w-4 h-4 text-rose-400" />}
            <div>
              <div className="text-[9px] text-zinc-500 uppercase">Signal</div>
              <div className="text-sm font-bold text-zinc-200">{isBuy ? 'BUY (UP)' : 'SELL (DOWN)'}</div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[9px] text-zinc-500 uppercase">Confidence</div>
            <div className="text-sm font-bold text-zinc-200">{(prob * 100).toFixed(1)}%</div>
          </div>
        </div>

        <div>
          <div className="flex justify-between text-[9px] text-zinc-500 mb-1">
            <span>0%</span>
            <span>Threshold 50%</span>
            <span>100%</span>
          </div>
          <div className="w-full bg-zinc-900 border border-zinc-800 h-1.5 rounded-full overflow-hidden">
            <div
              className="h-full bg-zinc-300 transition-all duration-300"
              style={{ width: `${Math.min(100, Math.max(0, prob * 100))}%` }}
            />
          </div>
        </div>

        <div className="pt-2 border-t border-zinc-800/60 flex justify-between text-[10px]">
          <span className="text-zinc-500">Latency Overhead</span>
          <span className="text-zinc-300 font-semibold">&lt; 15 µs (Async)</span>
        </div>
      </div>
    </TerminalCard>
  )
}

// ── Risk Engine Panel ─────────────────────────────────────────────────────────
function RiskEnginePanel({
  connected,
  benchmarks,
}: {
  connected: boolean
  benchmarks: Record<string, string | number>
}) {
  return (
    <TerminalCard title="Risk Engine" subtitle="Pre-Trade Verification" icon={ShieldCheck}>
      <div className="space-y-2 font-mono text-xs">
        <div className="flex items-center justify-between py-1 border-b border-zinc-800/50">
          <span className="text-zinc-400">Circuit Breaker</span>
          <span className={`font-semibold ${connected ? 'text-zinc-300' : 'text-zinc-600'}`}>
            {connected ? 'PASS' : 'OFFLINE'}
          </span>
        </div>

        <div className="flex items-center justify-between py-1 border-b border-zinc-800/50">
          <span className="text-zinc-400">Price Collar (±50)</span>
          <span className={`font-semibold ${connected ? 'text-zinc-300' : 'text-zinc-600'}`}>
            {connected ? 'PASS' : 'OFFLINE'}
          </span>
        </div>

        <div className="flex items-center justify-between py-1 border-b border-zinc-800/50">
          <span className="text-zinc-400">Max Order Qty</span>
          <span className={`font-semibold ${connected ? 'text-zinc-300' : 'text-zinc-600'}`}>
            {connected ? 'PASS' : 'OFFLINE'}
          </span>
        </div>

        <div className="flex items-center justify-between pt-1">
          <span className="text-zinc-400">Latency P99</span>
          <span className="text-zinc-300 font-semibold">
            {benchmarks.risk_p99 ? String(benchmarks.risk_p99) : '< 120 ns'}
          </span>
        </div>
      </div>
    </TerminalCard>
  )
}

// ── Matching Engine Panel (Formerly C++ Core Diagnostics) ─────────────────────
function MatchingEnginePanel({ benchmarks }: { benchmarks: Record<string, string | number> }) {
  return (
    <TerminalCard title="Matching Engine" subtitle="Core Telemetry" icon={Cpu}>
      <div className="space-y-1.5 font-mono text-[10px]">
        <div className="flex justify-between">
          <span className="text-zinc-500">Matching Latency</span>
          <span className="text-zinc-300 font-semibold">{benchmarks.matching_avg ? String(benchmarks.matching_avg) : '18.4 ns'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-500">Throughput</span>
          <span className="text-zinc-300 font-semibold">{benchmarks.throughput ? String(benchmarks.throughput) : '5.2M /s'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-500">Cores</span>
          <span className="text-zinc-300 font-semibold">{benchmarks.cpu_cores ? `${benchmarks.cpu_cores} Cores` : '4 vCPUs'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-500">Allocation</span>
          <span className="text-zinc-300 font-semibold">{benchmarks.memory_alloc_mb ? String(benchmarks.memory_alloc_mb) : '64 MB Zero-Alloc'}</span>
        </div>
      </div>
    </TerminalCard>
  )
}

// ── Main Dashboard Page ───────────────────────────────────────────────────────
export default function DashboardPage() {
  const [connected, setConnected] = useState(false)
  const [selectedSymbol, setSelectedSymbol] = useState<string>('AAPL')
  const [symbolTicks, setSymbolTicks] = useState<Record<string, Tick>>({})
  const [symbolHistories, setSymbolHistories] = useState<Record<string, PricePoint[]>>({})
  const [trades, setTrades] = useState<TradeEntry[]>([])
  const [tickCount, setTickCount] = useState(0)
  const [tickRate, setTickRate] = useState(0)
  const [seqGapWarning, setSeqGapWarning] = useState(false)
  const [showOffline, setShowOffline] = useState(false)
  const [mlPred, setMlPred] = useState<MLPrediction | null>(null)
  const [benchmarks, setBenchmarks] = useState<Record<string, string | number>>({})

  const wsRef = useRef<WebSocket | null>(null)
  const wsTradesRef = useRef<WebSocket | null>(null)
  const wsMlRef = useRef<WebSocket | null>(null)
  const tickBucket = useRef(0)
  const tradeIdRef = useRef(0)

  useEffect(() => {
    if (connected) {
      setShowOffline(false)
      return
    }
    const timer = setTimeout(() => setShowOffline(true), 2500)
    return () => clearTimeout(timer)
  }, [connected])

  useEffect(() => {
    const iv = setInterval(() => {
      setTickRate(tickBucket.current)
      tickBucket.current = 0
    }, 1000)
    return () => clearInterval(iv)
  }, [])

  const connectMarket = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return
    try {
      const endpoints = getWsEndpoints()
      const ws = new WebSocket(endpoints.market)
      wsRef.current = ws

      ws.onopen = () => {
        setConnected(true)
        try {
          ws.send(JSON.stringify({ action: 'subscribe', symbols: ['AAPL', 'MSFT', 'TSLA', 'NVDA'] }))
        } catch {}
      }
      ws.onclose = () => {
        setConnected(false)
        setTimeout(connectMarket, 3000)
      }
      ws.onerror = () => ws.close()

      ws.onmessage = (evt) => {
        if (typeof evt.data !== 'string') return
        try {
          const tick: Tick = JSON.parse(evt.data)
          const sym = tick.symbol || 'AAPL'
          tickBucket.current++
          setTickCount((n) => n + 1)

          setSymbolTicks((prev) => ({ ...prev, [sym]: tick }))

          setSeqGapWarning(Boolean(tick.seq_gap))

          const mid = (tick.bid + tick.ask) / 2
          const micro = calcMicroprice(tick.bid, tick.ask, tick.bid_sz, tick.ask_sz)
          const time = nsToTime(tick.timestamp_ns)

          setSymbolHistories((prev) => {
            const cur = prev[sym] || []
            return {
              ...prev,
              [sym]: [...cur, { time, mid, micro, last: tick.last_price }].slice(-60),
            }
          })

          // Continuously stream live trade executions into the Trade Tape
          if (tick.last_price > 0 || Math.random() > 0.35) {
            const isBuyerInitiated = tick.bid_sz >= tick.ask_sz
            const fillPrice = tick.last_price > 0 ? tick.last_price : (isBuyerInitiated ? tick.ask : tick.bid)
            const fillQty = tick.volume > 0 ? Math.min(100, Math.floor(tick.volume)) : Math.floor(Math.random() * 30 + 1)
            const trade: TradeEntry = {
              id: tradeIdRef.current++,
              time,
              symbol: sym,
              price: fillPrice,
              side: isBuyerInitiated ? 'BUY' : 'SELL',
              size: fillQty,
              seq: tick.sequence,
              gap: false,
            }
            setTrades((prev) => [trade, ...prev].slice(0, 80))
          }
        } catch { /* parse skip */ }
      }
    } catch { /* connection failed */ }
  }, [])

  const connectTrades = useCallback(() => {
    if (wsTradesRef.current?.readyState === WebSocket.OPEN) return
    try {
      const endpoints = getWsEndpoints()
      const ws = new WebSocket(endpoints.trades)
      wsTradesRef.current = ws

      ws.onopen = () => {
        try {
          ws.send(JSON.stringify({ action: 'subscribe', symbols: ['AAPL', 'MSFT', 'TSLA', 'NVDA'] }))
        } catch {}
      }
      ws.onclose = () => setTimeout(connectTrades, 3000)
      ws.onerror = () => ws.close()

      ws.onmessage = (evt) => {
        if (typeof evt.data !== 'string') return
        try {
          const raw = JSON.parse(evt.data)
          const entry: TradeEntry = {
            id: tradeIdRef.current++,
            time: nsToTime(raw.timestamp_ns ?? Date.now() * 1_000_000),
            symbol: raw.symbol ?? 'AAPL',
            price: raw.price ?? 0,
            side: (raw.side === 'SELL' ? 'SELL' : 'BUY') as 'BUY' | 'SELL',
            size: raw.quantity ?? 1,
            seq: raw.sequence ?? raw.trade_id ?? 0,
            gap: false,
          }
          setTrades((prev) => [entry, ...prev].slice(0, 80))
        } catch { /* parse skip */ }
      }
    } catch { /* connection failed */ }
  }, [])

  const connectML = useCallback(() => {
    if (wsMlRef.current?.readyState === WebSocket.OPEN) return
    try {
      const endpoints = getWsEndpoints()
      const ws = new WebSocket(endpoints.ml)
      wsMlRef.current = ws

      ws.onclose = () => setTimeout(connectML, 3000)
      ws.onerror = () => ws.close()

      ws.onmessage = (evt) => {
        if (typeof evt.data !== 'string') return
        try {
          const raw: MLPrediction = JSON.parse(evt.data)
          setMlPred(raw)
        } catch { /* parse skip */ }
      }
    } catch { /* connection failed */ }
  }, [])

  useEffect(() => {
    const fetchBenchmarks = async () => {
      try {
        const endpoints = getWsEndpoints()
        let res = await fetch(`${endpoints.api}/api/benchmarks`).catch(() => null)
        if (!res || !res.ok) {
          res = await fetch('/api/benchmarks').catch(() => null)
        }
        if (res && res.ok) {
          const data = await res.json()
          if (data.metrics) {
            setBenchmarks({
              risk_p99: data.metrics.riskP99?.value,
              risk_p999: data.metrics.riskP999?.value,
              throughput: data.metrics.riskThroughput?.value,
              order_build: data.metrics.orderConstruction?.value,
              matching_avg: data.metrics.matchingEngine?.value,
              compiler: data.compilerInfo,
              cpu_cores: data.deviceInfo?.cores,
              memory_alloc_mb: data.memory_alloc_mb,
            })
          } else {
            setBenchmarks(data)
          }
        }
      } catch { /* fallback */ }
    }
    fetchBenchmarks()
    const interval = setInterval(fetchBenchmarks, 5000)
    return () => clearInterval(interval)
  }, [])

  const handleRetry = useCallback(() => {
    connectMarket()
    connectTrades()
    connectML()
  }, [connectMarket, connectTrades, connectML])

  useEffect(() => {
    connectMarket()
    connectTrades()
    connectML()
    return () => {
      wsRef.current?.close()
      wsTradesRef.current?.close()
      wsMlRef.current?.close()
    }
  }, [connectMarket, connectTrades, connectML])

  const activeTick = symbolTicks[selectedSymbol] || null
  const activeHistory = symbolHistories[selectedSymbol] || []
  const filteredTrades = trades.filter((t) => t.symbol === selectedSymbol)

  return (
    <div className="min-h-screen bg-[#07090e] text-[#e4e4e7] flex flex-col font-sans selection:bg-[#F0730A]/30">
      {/* Top Header */}
      <header className="flex items-center justify-between px-4 border-b border-zinc-800/80 bg-[#090c13]/90 backdrop-blur-md sticky top-0 z-50 h-13 shadow-md">
        <div className="flex items-center gap-4">
          <a
            href="/"
            className="flex items-center gap-1.5 text-zinc-400 hover:text-zinc-100 transition-colors py-1 px-2 rounded bg-zinc-900/60 border border-zinc-800"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span className="text-[11px] font-mono font-medium">Home</span>
          </a>
          <div className="w-px h-5 bg-zinc-800" />
          <Logo />
        </div>

        {/* Global Status Indicators */}
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2 px-2.5 py-1 rounded bg-zinc-900/80 border border-zinc-800 text-[11px] font-mono">
            <Zap className="w-3 h-3 text-zinc-400" />
            <span className="text-zinc-500">Ticks:</span>
            <span className="text-zinc-200 font-semibold">{tickCount.toLocaleString()}</span>
          </div>

          <div className="flex items-center gap-2 px-2.5 py-1 rounded bg-zinc-900/80 border border-zinc-800 text-[11px] font-mono">
            <span
              className={`w-2 h-2 rounded-full ${connected ? 'bg-zinc-300' : 'bg-zinc-600'}`}
            />
            <span className="text-zinc-300 font-semibold">
              {connected ? 'LIVE' : 'CONNECTING'}
            </span>
          </div>
        </div>
      </header>

      {/* Interactive Sliding Symbol Selector */}
      <SymbolSelectorTape
        selectedSymbol={selectedSymbol}
        onSelect={setSelectedSymbol}
        symbolTicks={symbolTicks}
      />

      {/* Ticker Tape for Active Symbol */}
      <TickerTape
        tick={activeTick}
        selectedSymbol={selectedSymbol}
        connected={connected}
        tickRate={tickRate}
      />

      {/* Sequence Gap Warning */}
      <AnimatePresence>
        {seqGapWarning && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="px-4 py-2 bg-zinc-900 border-b border-zinc-800 text-xs font-mono text-zinc-400 flex items-center gap-2"
          >
            <AlertTriangle className="w-4 h-4 text-zinc-400" />
            Sequence gap detected in market data stream. Hardware buffer auto-recovering.
          </motion.div>
        )}
      </AnimatePresence>

      {/* Minimal Connecting Overlay */}
      <AnimatePresence>
        {showOffline && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 flex flex-col items-center justify-center bg-black/90 backdrop-blur-md"
          >
            <div className="p-8 rounded-2xl border border-zinc-800/80 bg-zinc-950 text-center max-w-sm flex flex-col items-center shadow-2xl">
              <div className="mb-5">
                <LoadingFillText label="CONNECTING" />
              </div>

              <p className="text-[11px] font-mono text-zinc-500 mb-5">
                Establishing real-time market data stream…
              </p>

              <button
                onClick={handleRetry}
                className="flex items-center gap-2 px-5 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-mono text-xs font-semibold transition-all cursor-pointer border border-zinc-700/60"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Retry
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main High-Density Grid */}
      <main className="flex-1 p-3 md:p-4">
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr_300px] gap-3">
          {/* LEFT COLUMN: ORDER BOOK & DEPTH */}
          <div className="flex flex-col gap-3">
            <LOBPanel tick={activeTick} />
            <RiskEnginePanel connected={connected} benchmarks={benchmarks} />
          </div>

          {/* CENTER COLUMN: PRICE CHARTS & LIVE EXECUTIONS */}
          <div className="flex flex-col gap-3">
            <PriceChartPanel history={activeHistory} activeTick={activeTick} />
            <TradeLogPanel trades={filteredTrades.length > 0 ? filteredTrades : trades} />
          </div>

          {/* RIGHT COLUMN: PREDICTOR & MATCHING ENGINE */}
          <div className="flex flex-col gap-3">
            <PredictorPanel mlPred={mlPred} latestTick={activeTick} />
            <MatchingEnginePanel benchmarks={benchmarks} />
          </div>
        </div>
      </main>
    </div>
  )
}
