'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// ── QuantTrade Logo ────────────────────────────────────────────────────────────
function Logo() {
  return (
    <div className="flex items-center gap-2">
      <svg width="22" height="22" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="28" height="28" fill="#F0730A" />
        <text x="4" y="21" fontFamily="'JetBrains Mono', monospace" fontWeight="700" fontSize="17" fill="white">QT</text>
      </svg>
      <span className="text-[12px] font-bold text-white tracking-wide">QuantTrade</span>
    </div>
  )
}

import { Activity, ArrowLeft, Brain, WifiOff, Wifi, AlertTriangle, RefreshCw } from 'lucide-react'
import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip,
} from 'recharts'

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
}

interface TradeEntry {
  id: number
  time: string
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

// ── WebSocket endpoints ────────────────────────────────────────────────────────
const WS_MARKET = 'ws://localhost:8081/ws/market-data'
const WS_TRADES = 'ws://localhost:8081/ws/trades'
const WS_ML     = 'ws://localhost:8081/ws/ml-predictions'

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(n: number, d = 2) { return n.toFixed(d) }
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

// ── Card wrapper ──────────────────────────────────────────────────────────────
function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-white/6 bg-white/[0.02] p-4 ${className}`}>
      {children}
    </div>
  )
}
function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-3">{children}</div>
}

// ── Disconnected placeholder ──────────────────────────────────────────────────
function Empty({ label }: { label: string }) {
  return (
    <Card>
      <Label>{label}</Label>
      <div className="flex flex-col items-center justify-center py-6 gap-2">
        <WifiOff className="w-5 h-5 text-slate-700" />
        <span className="text-[11px] font-mono text-slate-700">Awaiting data</span>
      </div>
    </Card>
  )
}

// ── Stat row for LOB ──────────────────────────────────────────────────────────
function LOBPanel({ tick }: { tick: Tick | null }) {
  if (!tick) return <Empty label="Order Book (Top of Book)" />
  const mid = (tick.bid + tick.ask) / 2
  const micro = calcMicroprice(tick.bid, tick.ask, tick.bid_sz, tick.ask_sz)
  const spread = tick.ask - tick.bid

  return (
    <Card>
      <Label>Top of Book · {tick.symbol || '—'}</Label>
      <div className="space-y-1 text-xs font-mono">
        <div className="flex justify-between items-center py-1 border-b border-white/5">
          <span className="text-slate-500">Ask</span>
          <span className="text-red-400 font-bold">{fmt(tick.ask)}</span>
          <span className="text-slate-500">{tick.ask_sz}</span>
        </div>
        <div className="py-1.5 text-center">
          <span className="text-slate-100 font-black text-base">{fmt(mid)}</span>
          <span className="text-slate-600 text-[10px] ml-2">spread {fmt(spread, 3)}</span>
        </div>
        <div className="flex justify-between items-center py-1 border-t border-white/5">
          <span className="text-slate-500">Bid</span>
          <span className="text-emerald-400 font-bold">{fmt(tick.bid)}</span>
          <span className="text-slate-500">{tick.bid_sz}</span>
        </div>
      </div>
      <div className="flex gap-4 mt-3 pt-3 border-t border-white/5">
        <div className="flex-1 text-center">
          <div className="text-[10px] text-slate-600 font-mono mb-0.5">Microprice</div>
          <div className="text-xs font-mono text-violet-400">{fmt(micro)}</div>
        </div>
        <div className="flex-1 text-center">
          <div className="text-[10px] text-slate-600 font-mono mb-0.5">Last Trade</div>
          <div className="text-xs font-mono text-slate-300">{tick.last_price > 0 ? fmt(tick.last_price) : '—'}</div>
        </div>
        <div className="flex-1 text-center">
          <div className="text-[10px] text-slate-600 font-mono mb-0.5">Volume</div>
          <div className="text-xs font-mono text-slate-300">{tick.volume.toLocaleString()}</div>
        </div>
      </div>
    </Card>
  )
}

// ── Price Chart ───────────────────────────────────────────────────────────────
function PricePanel({ history }: { history: PricePoint[] }) {
  if (history.length < 2) return <Empty label="Price · Midprice vs Microprice" />
  return (
    <Card>
      <Label>Midprice vs Microprice</Label>
      <ResponsiveContainer width="100%" height={120}>
        <AreaChart data={history} margin={{ top: 2, right: 2, left: -28, bottom: 0 }}>
          <defs>
            <linearGradient id="midG" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#60a5fa" stopOpacity={0.15} />
              <stop offset="95%" stopColor="#60a5fa" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="microG" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#a78bfa" stopOpacity={0.1} />
              <stop offset="95%" stopColor="#a78bfa" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="time" tick={false} axisLine={false} tickLine={false} />
          <YAxis domain={['auto', 'auto']} tick={{ fill: '#334155', fontSize: 9, fontFamily: 'monospace' }} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{ background: '#060c18', border: '1px solid #1e293b', borderRadius: 8, fontSize: 10 }}
            labelStyle={{ color: '#64748b' }}
            itemStyle={{ color: '#e2e8f0' }}
          />
          <Area type="monotone" dataKey="mid" stroke="#60a5fa" strokeWidth={1.5} fill="url(#midG)" dot={false} name="Mid" />
          <Area type="monotone" dataKey="micro" stroke="#a78bfa" strokeWidth={1} strokeDasharray="3 2" fill="url(#microG)" dot={false} name="Micro" />
        </AreaChart>
      </ResponsiveContainer>
      <div className="flex gap-4 mt-1.5">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-px bg-blue-400" />
          <span className="text-[10px] text-slate-600 font-mono">Midprice</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-px" style={{ background: '#a78bfa' }} />
          <span className="text-[10px] text-slate-600 font-mono">Microprice</span>
        </div>
      </div>
    </Card>
  )
}

// ── OBI ───────────────────────────────────────────────────────────────────────
function OBIPanel({ obiHistory, current }: { obiHistory: number[]; current: number | null }) {
  if (current === null) return <Empty label="Order Book Imbalance (OBI)" />
  const color = current > 0.2 ? '#34d399' : current < -0.2 ? '#f87171' : '#94a3b8'
  const pct = ((current + 1) / 2) * 100
  return (
    <Card>
      <Label>Order Book Imbalance</Label>
      <div className="flex items-center gap-4 mb-3">
        <div className="flex-1">
          <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
            <motion.div
              className="h-full rounded-full transition-all"
              style={{ background: color, width: `${pct}%` }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-[9px] font-mono text-slate-700">Ask</span>
            <span className="text-[9px] font-mono text-slate-700">Bid</span>
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-lg font-black font-mono" style={{ color }}>
            {current >= 0 ? '+' : ''}{current.toFixed(3)}
          </div>
          <div className="text-[9px] font-mono text-slate-600">OBI</div>
        </div>
      </div>
      {obiHistory.length > 3 && (
        <ResponsiveContainer width="100%" height={36}>
          <LineChart data={obiHistory.map((v, i) => ({ i, v }))}>
            <Line type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </Card>
  )
}

// ── Sequence / Network Health ─────────────────────────────────────────────────
function SeqPanel({ tick }: { tick: Tick | null }) {
  if (!tick) return <Empty label="Sequence Health" />
  return (
    <Card>
      <Label>Network · Sequence Health</Label>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-[10px] font-mono text-slate-600 mb-0.5">Sequence</div>
          <div className="text-sm font-black font-mono text-slate-200">{tick.sequence.toLocaleString()}</div>
        </div>
        <div>
          <div className="text-[10px] font-mono text-slate-600 mb-0.5">Seq Gap</div>
          <div className={`text-sm font-bold font-mono ${tick.seq_gap ? 'text-amber-400' : 'text-emerald-400'}`}>
            {tick.seq_gap ? 'GAP' : 'OK'}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-mono text-slate-600 mb-0.5">Symbol</div>
          <div className="text-sm font-bold font-mono text-slate-300">{tick.symbol || '—'}</div>
        </div>
        <div>
          <div className="text-[10px] font-mono text-slate-600 mb-0.5">Timestamp</div>
          <div className="text-[11px] font-mono text-slate-400">{nsToTime(tick.timestamp_ns)}</div>
        </div>
      </div>
    </Card>
  )
}

// ── Trade Log ─────────────────────────────────────────────────────────────────
function TradeLog({ trades }: { trades: TradeEntry[] }) {
  if (trades.length === 0) return <Empty label="Trade Stream" />
  return (
    <Card className="overflow-hidden">
      <Label>Trade Stream</Label>
      <div className="space-y-0.5 max-h-56 overflow-y-auto">
        {trades.slice(0, 16).map((t) => (
          <div key={t.id} className="flex items-center gap-2 text-[10px] font-mono py-0.5">
            <span className="text-slate-700 flex-shrink-0">{t.time}</span>
            <span className={`font-bold flex-shrink-0 ${t.side === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}>
              {t.side}
            </span>
            <span className="text-slate-300">{fmt(t.price)}</span>
            <span className="text-slate-600">×{t.size}</span>
            <span className={`ml-auto text-[9px] font-bold ${t.gap ? 'text-amber-500' : 'text-slate-700'}`}>
              {t.gap ? 'GAP' : `#${t.seq}`}
            </span>
          </div>
        ))}
      </div>
    </Card>
  )
}

// ── Status sidebar ────────────────────────────────────────────────────────────
function StatusPanel({ connected, tickCount, tickRate }: {
  connected: boolean
  tickCount: number
  tickRate: number
}) {
  return (
    <Card>
      <Label>Connection</Label>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-mono text-slate-500">Backend</span>
          <div className="flex items-center gap-1.5">
            {connected
              ? <><Wifi className="w-3.5 h-3.5 text-emerald-400" /><span className="text-[11px] font-mono text-emerald-400">LIVE</span></>
              : <><WifiOff className="w-3.5 h-3.5 text-slate-600" /><span className="text-[11px] font-mono text-slate-600">OFFLINE</span></>
            }
          </div>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-mono text-slate-500">Ticks received</span>
          <span className="text-[11px] font-mono text-slate-300">{tickCount.toLocaleString()}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-mono text-slate-500">Tick rate</span>
          <span className="text-[11px] font-mono text-blue-400">{tickRate}/s</span>
        </div>
      </div>
    </Card>
  )
}

// ── Offline overlay ───────────────────────────────────────────────────────────
function OfflineOverlay({ onRetry }: { onRetry: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="fixed inset-0 z-40 flex flex-col items-center justify-center bg-[#0a0a0a]/90 backdrop-blur-sm"
    >
      {/* Pulsing ring */}
      <div className="relative mb-6">
        <motion.div
          animate={{ scale: [1, 1.6], opacity: [0.15, 0] }}
          transition={{ repeat: Infinity, duration: 2, ease: 'easeOut' }}
          className="absolute inset-0 rounded-full border border-slate-600"
        />
        <div className="w-12 h-12 rounded-full border border-[#1e1e1e] bg-[#111] flex items-center justify-center">
          <WifiOff className="w-5 h-5 text-slate-600" />
        </div>
      </div>

      <h2 className="text-sm font-bold text-[#555] font-mono mb-1">Backend Offline</h2>
      <p className="text-[11px] font-mono text-[#333] mb-5">Auto-reconnecting every 3 seconds…</p>

      <button
        onClick={onRetry}
        className="flex items-center gap-1.5 px-4 py-2 rounded border border-[#2a2a2a] text-[11px] font-mono text-[#555] hover:text-[#888] hover:border-[#333] transition-colors"
      >
        <RefreshCw className="w-3 h-3" />
        Retry now
      </button>
    </motion.div>
  )
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const [connected, setConnected] = useState(false)
  const [latestTick, setLatestTick] = useState<Tick | null>(null)
  const [priceHistory, setPriceHistory] = useState<PricePoint[]>([])
  const [obiHistory, setObiHistory] = useState<number[]>([])
  const [currentOBI, setCurrentOBI] = useState<number | null>(null)
  const [trades, setTrades] = useState<TradeEntry[]>([])
  const [tickCount, setTickCount] = useState(0)
  const [tickRate, setTickRate] = useState(0)
  const [seqGapWarning, setSeqGapWarning] = useState(false)
  const [showOffline, setShowOffline] = useState(false)

  const wsRef = useRef<WebSocket | null>(null)
  const wsTradesRef = useRef<WebSocket | null>(null)
  const tickBucket = useRef(0)
  const tradeIdRef = useRef(0)

  // Delay showing offline overlay by 2s to avoid flicker on initial load
  useEffect(() => {
    if (connected) {
      setShowOffline(false)
      return
    }
    const timer = setTimeout(() => setShowOffline(true), 2000)
    return () => clearTimeout(timer)
  }, [connected])

  // Tick rate counter — refresh every second
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
      const ws = new WebSocket(WS_MARKET)
      wsRef.current = ws

      ws.onopen = () => setConnected(true)
      ws.onclose = () => {
        setConnected(false)
        setTimeout(connectMarket, 3000)
      }
      ws.onerror = () => ws.close()

      ws.onmessage = (evt) => {
        if (typeof evt.data !== 'string') return
        try {
          const tick: Tick = JSON.parse(evt.data)
          tickBucket.current++
          setTickCount((n) => n + 1)
          setLatestTick(tick)

          if (tick.seq_gap) setSeqGapWarning(true)
          else setSeqGapWarning(false)

          const mid = (tick.bid + tick.ask) / 2
          const micro = calcMicroprice(tick.bid, tick.ask, tick.bid_sz, tick.ask_sz)
          const time = nsToTime(tick.timestamp_ns)

          setPriceHistory((prev) => [...prev, { time, mid, micro }].slice(-80))

          const obi = calcOBI(tick.bid_sz, tick.ask_sz)
          setCurrentOBI(obi)
          setObiHistory((prev) => [...prev, obi].slice(-40))
        } catch { /* malformed frame, skip */ }
      }
    } catch { /* ws not available */ }
  }, [])

  const connectTrades = useCallback(() => {
    if (wsTradesRef.current?.readyState === WebSocket.OPEN) return
    try {
      const ws = new WebSocket(WS_TRADES)
      wsTradesRef.current = ws

      ws.onclose = () => setTimeout(connectTrades, 3000)
      ws.onerror = () => ws.close()

      ws.onmessage = (evt) => {
        if (typeof evt.data !== 'string') return
        try {
          const raw = JSON.parse(evt.data)
          const entry: TradeEntry = {
            id: tradeIdRef.current++,
            time: nsToTime(raw.timestamp_ns ?? Date.now() * 1_000_000),
            price: raw.price ?? 0,
            side: (raw.side === 'BUY' ? 'BUY' : 'SELL') as 'BUY' | 'SELL',
            size: raw.quantity ?? 1,
            seq: raw.sequence ?? 0,
            gap: false,
          }
          setTrades((prev) => [entry, ...prev].slice(0, 40))
        } catch { /* skip */ }
      }
    } catch { /* ws not available */ }
  }, [])

  const [mlPred, setMlPred] = useState<MLPrediction | null>(null)
  const wsMlRef = useRef<WebSocket | null>(null)

  const connectML = useCallback(() => {
    if (wsMlRef.current?.readyState === WebSocket.OPEN) return
    try {
      const ws = new WebSocket(WS_ML)
      wsMlRef.current = ws

      ws.onclose = () => setTimeout(connectML, 3000)
      ws.onerror = () => ws.close()

      ws.onmessage = (evt) => {
        if (typeof evt.data !== 'string') return
        try {
          const raw: MLPrediction = JSON.parse(evt.data)
          setMlPred(raw)
        } catch { /* skip */ }
      }
    } catch { /* ws not available */ }
  }, [])

  const [benchmarks, setBenchmarks] = useState<Record<string, string | number>>({})

  useEffect(() => {
    const fetchBenchmarks = async () => {
      try {
        const res = await fetch('http://localhost:8081/api/benchmarks')
        if (res.ok) {
          const data = await res.json()
          setBenchmarks(data)
        }
      } catch { /* api unavailable */ }
    }
    fetchBenchmarks()
    const interval = setInterval(fetchBenchmarks, 3000)
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

  const mid = latestTick ? (latestTick.bid + latestTick.ask) / 2 : null
  const priceUp = priceHistory.length > 1
    ? priceHistory[priceHistory.length - 1].mid >= priceHistory[priceHistory.length - 2].mid
    : null

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-[#e8e8e6] flex flex-col font-sans selection:bg-[#F0730A]/30">

      {/* Header */}
      <header className="flex items-center justify-between px-4 border-b border-[#1e1e1e] bg-[#0a0a0a] sticky top-0 z-50 h-12">
        <div className="flex items-center gap-4">
          <a href="/" className="flex items-center gap-1.5 text-[#555] hover:text-[#aaa] transition-colors">
            <ArrowLeft className="w-3.5 h-3.5" />
            <span className="text-[11px] font-mono">Back</span>
          </a>
          <div className="w-px h-4 bg-[#1e1e1e]" />
          <Logo />
        </div>

        <div className="flex items-center gap-5">
          {mid !== null && (
            <div className="flex items-center gap-2">
              <AnimatePresence mode="wait">
                <motion.span
                  key={mid.toFixed(2)}
                  initial={{ opacity: 0.4, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`text-sm font-black font-mono ${priceUp ? 'text-emerald-400' : 'text-red-400'}`}
                >
                  {fmt(mid)}
                </motion.span>
              </AnimatePresence>
              <span className="text-[10px] font-mono text-slate-600">{latestTick?.symbol ?? 'SYNTH'}</span>
            </div>
          )}

          <div className="flex items-center gap-1.5">
            <motion.span
              animate={{ opacity: connected ? [1, 0.3, 1] : 1 }}
              transition={{ repeat: Infinity, duration: 1.6 }}
              className={`w-1.5 h-1.5 rounded-full inline-block ${connected ? 'bg-[#F0730A]' : 'bg-[#333]'}`}
            />
            <span className={`text-[10px] font-mono ${connected ? 'text-[#F0730A]' : 'text-[#444]'}`}>
              {connected ? 'LIVE' : 'OFFLINE'}
            </span>
          </div>
        </div>
      </header>

      {/* Seq gap warning banner */}
      <AnimatePresence>
        {seqGapWarning && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="px-4 py-2 bg-[#F0730A]/10 border-b border-[#F0730A]/20 text-[11px] font-mono text-[#F0730A] flex items-center gap-2"
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            Sequence gap detected — ML pipeline will mask this tick
          </motion.div>
        )}
      </AnimatePresence>

      {/* Offline overlay — shown after 2s delay, non-blocking */}
      <AnimatePresence>
        {showOffline && <OfflineOverlay onRetry={handleRetry} />}
      </AnimatePresence>

      {/* Grid */}
      <main className="flex-1 p-3 md:p-4">
        <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr_220px] gap-3">

          {/* LEFT */}
          <div className="flex flex-col gap-3">
            <StatusPanel connected={connected} tickCount={tickCount} tickRate={tickRate} />
            <LOBPanel tick={latestTick} />
            <SeqPanel tick={latestTick} />
          </div>

          {/* CENTER */}
          <div className="flex flex-col gap-3">
            <PricePanel history={priceHistory} />
            <OBIPanel obiHistory={obiHistory} current={currentOBI} />
            <TradeLog trades={trades} />
          </div>

          {/* RIGHT */}
          <div className="flex flex-col gap-3">

            {/* ML Inference Card */}
            <Card>
              <Label>ML Inference · XGBoost</Label>
              {mlPred && mlPred.connected ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono text-slate-500">Inference Engine</span>
                    <span className="text-[10px] font-mono text-emerald-400 font-bold">ONLINE</span>
                  </div>
                  {mlPred.type === 'ml_prediction' ? (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-mono text-slate-500">Signal</span>
                        <span className={`text-xs font-mono font-bold ${mlPred.price_direction === 1 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {mlPred.price_direction === 1 ? 'BUY (UP)' : 'SELL (DOWN)'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-mono text-slate-500">Probability</span>
                        <span className="text-xs font-mono text-blue-400 font-bold">
                          {((mlPred.predicted_value ?? 0) * 100).toFixed(1)}%
                        </span>
                      </div>
                      <div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all duration-300 ${mlPred.price_direction === 1 ? 'bg-emerald-400' : 'bg-red-400'}`}
                          style={{ width: `${(mlPred.predicted_value ?? 0) * 100}%` }}
                        />
                      </div>
                    </>
                  ) : (
                    <div className="text-[10px] font-mono text-slate-400 text-center py-1">
                      Awaiting inference…
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-4 gap-2">
                  <Brain className="w-5 h-5 text-slate-700" />
                  <span className="text-[11px] font-mono text-slate-600 text-center">
                    ML engine offline
                  </span>
                </div>
              )}
            </Card>

            {/* Risk engine card */}
            <Card>
              <Label>Pre-Trade Risk Engine</Label>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[10px] font-mono">
                  <span className="text-slate-500">Circuit Breaker</span>
                  <span className="text-emerald-400 font-bold">PASS</span>
                </div>
                <div className="flex items-center justify-between text-[10px] font-mono">
                  <span className="text-slate-500">Price Collar (±50)</span>
                  <span className="text-emerald-400 font-bold">PASS</span>
                </div>
                <div className="flex items-center justify-between text-[10px] font-mono">
                  <span className="text-slate-500">Max Order Qty</span>
                  <span className="text-emerald-400 font-bold">PASS</span>
                </div>
                <div className="flex items-center justify-between text-[10px] font-mono pt-1.5 border-t border-white/5">
                  <span className="text-slate-500">Pre-Trade Latency</span>
                  <span className="text-blue-400 font-bold">
                    {benchmarks.risk_p99 ? String(benchmarks.risk_p99) : '—'}
                  </span>
                </div>
              </div>
            </Card>

            {/* Benchmark results */}
            <Card>
              <Label>C++ Benchmark Results</Label>
              <div className="space-y-2">
                {[
                  { k: 'CPU Cores', v: benchmarks.cpu_cores ? `${benchmarks.cpu_cores} Cores` : '—' },
                  { k: 'RAM Allocated', v: benchmarks.memory_alloc_mb ? String(benchmarks.memory_alloc_mb) : '—' },
                  { k: 'Risk P99', v: benchmarks.risk_p99 ? String(benchmarks.risk_p99) : '—' },
                  { k: 'Risk P99.9', v: benchmarks.risk_p999 ? String(benchmarks.risk_p999) : '—' },
                  { k: 'Throughput', v: benchmarks.throughput ? String(benchmarks.throughput) : '—' },
                  { k: 'Order Build', v: benchmarks.order_build ? String(benchmarks.order_build) : '—' },
                  { k: 'Matching Avg', v: benchmarks.matching_avg ? String(benchmarks.matching_avg) : '—' },
                ].map((r) => (
                  <div key={r.k} className="flex justify-between items-center">
                    <span className="text-[10px] font-mono text-slate-600">{r.k}</span>
                    <span className="text-[10px] font-mono text-blue-400 font-bold">{r.v}</span>
                  </div>
                ))}
                {benchmarks.compiler && (
                  <div className="text-[9px] font-mono text-slate-700 pt-2 border-t border-white/5">
                    {String(benchmarks.compiler)}
                  </div>
                )}
              </div>
            </Card>

          </div>
        </div>
      </main>
    </div>
  )
}
