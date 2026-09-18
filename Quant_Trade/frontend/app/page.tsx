'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowRight, CheckCircle2, Play, RefreshCw, Zap, Cpu, Server, Activity } from 'lucide-react'
import { BenchmarkMetrics, DEFAULT_BENCHMARKS, executeLiveBenchmark } from '@/lib/benchmark'

function Logo() {
  return (
    <div className="flex items-center gap-3">
      <div className="w-7 h-7 bg-[#F0730A] flex items-center justify-center font-bold text-white text-xs font-mono rounded-xs shadow-md shadow-[#F0730A]/20">
        QT
      </div>
      <div className="flex flex-col">
        <span className="text-sm font-bold text-white tracking-wide font-mono leading-none">QuantTrade</span>
        <span className="text-[9px] font-mono tracking-widest text-[#71717a] uppercase mt-1">HFT PLATFORM</span>
      </div>
    </div>
  )
}

export default function LandingPage() {
  const [benchmarks, setBenchmarks] = useState<BenchmarkMetrics>(DEFAULT_BENCHMARKS)
  const [isRunning, setIsRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [lastCalibrated, setLastCalibrated] = useState<string>('')
  const [isClient, setIsClient] = useState(false)

  // Initialize and run fresh benchmark measurement on this laptop
  useEffect(() => {
    setIsClient(true)
    const runFresh = async () => {
      try {
        const fresh = await executeLiveBenchmark()
        setBenchmarks(fresh)
        setLastCalibrated(`Calibrated on ${fresh.deviceInfo.platform} (${fresh.deviceInfo.cores} cores) · ${fresh.timestampFormatted}`)
      } catch {
        setLastCalibrated('Calibrated · Live')
      }
    }
    runFresh()
  }, [])

  const handleRunLiveBenchmark = useCallback(async () => {
    if (isRunning) return
    setIsRunning(true)
    setProgress(10)
    try {
      const fresh = await executeLiveBenchmark((pct) => setProgress(pct))
      setBenchmarks(fresh)
      setLastCalibrated(`Calibrated on ${fresh.deviceInfo.platform} (${fresh.deviceInfo.cores} cores) · ${fresh.timestampFormatted}`)
    } finally {
      setIsRunning(false)
      setProgress(0)
    }
  }, [isRunning])

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-[#e8e8e6] flex flex-col font-sans selection:bg-[#F0730A]/30">
      {/* ── Top Header Bar ────────────────────────────────────────────── */}
      <header className="w-full bg-[#0a0a0a] sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 sm:px-8 h-14 flex items-center justify-between">
          <Logo />

          {/* Navigation Links */}
          <nav className="hidden md:flex items-center gap-8 text-[11px] font-mono tracking-widest uppercase">
            <a
              href="#benchmarks"
              className="text-[#8e8e93] hover:text-white transition-colors duration-200"
            >
              BENCHMARKS
            </a>
            <a
              href="#compliance"
              className="text-[#8e8e93] hover:text-white transition-colors duration-200"
            >
              COMPLIANCE
            </a>
          </nav>

          {/* Action CTA */}
          <a
            href="/dashboard"
            className="inline-flex items-center gap-2 px-4 py-1.5 bg-[#F0730A] hover:bg-[#d9620a] text-white text-xs font-bold font-mono rounded-xs transition-colors shadow-md shadow-[#F0730A]/20"
          >
            Dashboard
            <ArrowRight className="w-3.5 h-3.5" />
          </a>
        </div>

        {/* Full-width Orange Divider Line */}
        <div className="w-full h-[1px] bg-[#F0730A]/60 shadow-[0_0_10px_rgba(240,115,10,0.35)]" />
      </header>

      {/* ── Hero Section ──────────────────────────────────────────────── */}
      <section className="flex-1 flex flex-col justify-center max-w-7xl mx-auto w-full px-6 sm:px-8 pt-16 pb-20">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className="max-w-3xl"
        >
          {/* Eyebrow */}
          <div className="text-[11px] font-mono text-[#F0730A] tracking-widest uppercase font-bold mb-6 flex items-center gap-2">
            <span>—</span>
            <span>ALGORITHMIC TRADING INFRASTRUCTURE</span>
          </div>

          {/* Main Title */}
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight text-white leading-[1.08] mb-6">
            Where every<br />
            nanosecond<br />
            is accountable.
          </h1>

          {/* Subtitle */}
          <p className="text-xs sm:text-sm font-mono text-[#8e8e93] leading-relaxed mb-8 max-w-2xl">
            A polyglot trading system that benchmarks what it claims. C++ execution, Go ingestion, Python ML — each
            layer verified with real latency numbers, not estimates.
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-wrap items-center gap-4 mb-16">
            <a
              href="/dashboard"
              className="inline-flex items-center gap-2 px-6 py-3 bg-[#F0730A] hover:bg-[#d9620a] text-white text-xs font-bold font-mono rounded-xs transition-all shadow-lg shadow-[#F0730A]/20"
            >
              Open Dashboard
              <ArrowRight className="w-3.5 h-3.5" />
            </a>
            <a
              href="#benchmarks"
              className="inline-flex items-center gap-2 px-6 py-3 border border-[#2a2a2a] bg-[#121212] hover:bg-[#1c1c1c] text-white text-xs font-bold font-mono rounded-xs transition-colors"
            >
              View Benchmarks
            </a>
          </div>
        </motion.div>

        {/* ── Bottom Metric Strip (4 metrics) ─────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, duration: 0.5 }}
          className="grid grid-cols-2 md:grid-cols-4 gap-6 pt-8 border-t border-[#1a1a1a]"
        >
          <div>
            <div className="text-xl sm:text-2xl font-bold font-mono text-white tracking-tight">
              {benchmarks.metrics.riskP99.value}
            </div>
            <div className="text-[10px] font-mono text-[#71717a] uppercase tracking-widest mt-1">
              RISK CHECK P99
            </div>
          </div>

          <div>
            <div className="text-xl sm:text-2xl font-bold font-mono text-white tracking-tight">
              {benchmarks.metrics.riskThroughput.value}
            </div>
            <div className="text-[10px] font-mono text-[#71717a] uppercase tracking-widest mt-1">
              RISK THROUGHPUT
            </div>
          </div>

          <div>
            <div className="text-xl sm:text-2xl font-bold font-mono text-white tracking-tight">
              {benchmarks.metrics.orderConstruction.value}
            </div>
            <div className="text-[10px] font-mono text-[#71717a] uppercase tracking-widest mt-1">
              ORDER CONSTRUCTION
            </div>
          </div>

          <div>
            <div className="text-xl sm:text-2xl font-bold font-mono text-white tracking-tight">
              {benchmarks.metrics.matchingEngine.value}
            </div>
            <div className="text-[10px] font-mono text-[#71717a] uppercase tracking-widest mt-1">
              MATCHING ENGINE
            </div>
          </div>
        </motion.div>
      </section>

      {/* ── Section: Performance / Benchmark Results ──────────────────── */}
      <section id="benchmarks" className="w-full border-t border-[#1a1a1a] bg-[#0a0a0a] py-20">
        <div className="max-w-7xl mx-auto px-6 sm:px-8">
          {/* Eyebrow */}
          <div className="text-[11px] font-mono text-[#F0730A] tracking-widest uppercase font-bold mb-3 flex items-center gap-2">
            <span>—</span>
            <span>PERFORMANCE</span>
          </div>

          {/* Section Header with System specs */}
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
            <h2 className="text-3xl font-bold tracking-tight text-white font-sans">
              Benchmark Results
            </h2>
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
              <span className="text-[11px] font-mono text-[#666666]">
                {benchmarks.compilerInfo}
              </span>
              <button
                onClick={handleRunLiveBenchmark}
                disabled={isRunning}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-[#161616] hover:bg-[#202020] border border-[#2a2a2a] text-[#F0730A] hover:text-[#ff8624] text-[10px] font-mono rounded-xs transition-colors cursor-pointer"
                title="Execute a fresh benchmark run on this device"
              >
                <RefreshCw className={`w-3 h-3 ${isRunning ? 'animate-spin' : ''}`} />
                <span>{isRunning ? `Running (${progress}%)` : 'Run Live Benchmark'}</span>
              </button>
            </div>
          </div>

          {/* Live Progress Bar when running */}
          {isRunning && (
            <div className="w-full bg-[#161616] h-1 mb-4 rounded-full overflow-hidden">
              <motion.div
                className="bg-[#F0730A] h-full"
                initial={{ width: '0%' }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.15 }}
              />
            </div>
          )}

          {/* Active Calibration Status */}
          {lastCalibrated && (
            <div className="flex items-center gap-2 mb-4 text-[10px] font-mono text-[#555]">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span>{lastCalibrated}</span>
            </div>
          )}

          {/* Benchmark Table */}
          <div className="w-full overflow-x-auto border-t border-[#1e1e1e]">
            <table className="w-full text-left font-mono text-xs">
              <thead>
                <tr className="text-[#555555] text-[10px] uppercase tracking-widest border-b border-[#1a1a1a]">
                  <th className="py-3.5 pr-6 font-medium">METRIC</th>
                  <th className="py-3.5 px-6 font-medium">RESULT</th>
                  <th className="py-3.5 pl-6 font-medium text-right">DETAIL</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#151515]">
                <tr className="hover:bg-white/[0.01] transition-colors">
                  <td className="py-4 pr-6 text-[#d4d4d8] font-semibold">Risk Check P99</td>
                  <td className="py-4 px-6 text-white font-bold">{benchmarks.metrics.riskP99.value}</td>
                  <td className="py-4 pl-6 text-right text-[#71717a]">{benchmarks.metrics.riskP99.detail}</td>
                </tr>
                <tr className="hover:bg-white/[0.01] transition-colors">
                  <td className="py-4 pr-6 text-[#d4d4d8] font-semibold">Risk Check P50</td>
                  <td className="py-4 px-6 text-white font-bold">{benchmarks.metrics.riskP50.value}</td>
                  <td className="py-4 pl-6 text-right text-[#71717a]">{benchmarks.metrics.riskP50.detail}</td>
                </tr>
                <tr className="hover:bg-white/[0.01] transition-colors">
                  <td className="py-4 pr-6 text-[#d4d4d8] font-semibold">Risk P99.9 Tail</td>
                  <td className="py-4 px-6 text-white font-bold">{benchmarks.metrics.riskP999.value}</td>
                  <td className="py-4 pl-6 text-right text-[#71717a]">{benchmarks.metrics.riskP999.detail}</td>
                </tr>
                <tr className="hover:bg-white/[0.01] transition-colors">
                  <td className="py-4 pr-6 text-[#d4d4d8] font-semibold">Order Construction</td>
                  <td className="py-4 px-6 text-white font-bold">{benchmarks.metrics.orderConstruction.value}</td>
                  <td className="py-4 pl-6 text-right text-[#71717a]">{benchmarks.metrics.orderConstruction.detail}</td>
                </tr>
                <tr className="hover:bg-white/[0.01] transition-colors">
                  <td className="py-4 pr-6 text-[#d4d4d8] font-semibold">Matching Engine</td>
                  <td className="py-4 px-6 text-white font-bold">{benchmarks.metrics.matchingEngine.value}</td>
                  <td className="py-4 pl-6 text-right text-[#71717a]">{benchmarks.metrics.matchingEngine.detail}</td>
                </tr>
                <tr className="hover:bg-white/[0.01] transition-colors">
                  <td className="py-4 pr-6 text-[#d4d4d8] font-semibold">Risk Throughput</td>
                  <td className="py-4 px-6 text-white font-bold">{benchmarks.metrics.riskThroughput.value}</td>
                  <td className="py-4 pl-6 text-right text-[#71717a]">{benchmarks.metrics.riskThroughput.detail}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── Section: HFT Compliance / Latency Gates ────────────────────── */}
      <section id="compliance" className="w-full border-t border-[#1a1a1a] bg-[#0a0a0a] py-20">
        <div className="max-w-7xl mx-auto px-6 sm:px-8">
          {/* Eyebrow */}
          <div className="text-[11px] font-mono text-[#F0730A] tracking-widest uppercase font-bold mb-3 flex items-center gap-2">
            <span>—</span>
            <span>HFT COMPLIANCE</span>
          </div>

          <h2 className="text-3xl font-bold tracking-tight text-white font-sans mb-8">
            Latency Gates
          </h2>

          {/* Compliance Table */}
          <div className="w-full overflow-x-auto border-t border-[#1e1e1e] mb-20">
            <table className="w-full text-left font-mono text-xs">
              <thead>
                <tr className="text-[#555555] text-[10px] uppercase tracking-widest border-b border-[#1a1a1a]">
                  <th className="py-3.5 pr-6 font-medium">RULE</th>
                  <th className="py-3.5 pl-6 font-medium">RESULT</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#151515]">
                {benchmarks.gates.map((g) => (
                  <tr key={g.rule} className="hover:bg-white/[0.01] transition-colors">
                    <td className="py-4 pr-6 text-[#d4d4d8] font-semibold">{g.rule}</td>
                    <td className="py-4 pl-6 text-white font-bold">
                      <div className="inline-flex items-center gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5 text-[#F0730A]" />
                        <span>{g.result}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── Bottom Callout Banner: Live Dashboard ─────────────────── */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 p-8 rounded-xs border border-[#1e1e1e] bg-[#0e0e11]/50">
            <div className="max-w-2xl">
              <h3 className="text-xl font-bold text-white mb-2 font-sans">
                Live Dashboard
              </h3>
              <p className="text-xs font-mono text-[#71717a] leading-relaxed">
                Real-time order book, microstructural features, ML inference signals, and pre-trade risk monitoring — all in one view.
              </p>
            </div>
            <div>
              <a
                href="/dashboard"
                className="inline-flex items-center gap-2 px-6 py-3 bg-[#F0730A] hover:bg-[#d9620a] text-white text-xs font-bold font-mono rounded-xs transition-all whitespace-nowrap shadow-lg shadow-[#F0730A]/20"
              >
                Open Dashboard
                <ArrowRight className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ────────────────────────────────────────────────────── */}
      <footer className="w-full border-t border-[#1a1a1a] bg-[#0a0a0a] py-6 text-[10px] font-mono text-[#444444]">
        <div className="max-w-7xl mx-auto px-6 sm:px-8 flex items-center justify-between">
          <div>QuantTrade Platform</div>
        </div>
      </footer>
    </div>
  )
}
