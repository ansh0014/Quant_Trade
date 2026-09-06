'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'

function Logo() {
  return (
    <div className="flex items-center gap-2">
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="28" height="28" fill="#F0730A" />
        <text x="4" y="21" fontFamily="'JetBrains Mono', monospace" fontWeight="700" fontSize="17" fill="white">QT</text>
      </svg>
      <span className="text-sm font-bold text-white tracking-wide font-mono">QuantTrade</span>
    </div>
  )
}

export default function LandingPage() {
  const [time, setTime] = useState('')

  useEffect(() => {
    const update = () => setTime(new Date().toISOString().slice(11, 19) + ' UTC')
    update()
    const t = setInterval(update, 1000)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-[#e8e8e6] flex flex-col font-sans selection:bg-[#F0730A]/30">

      {/* Header */}
      <header className="flex items-center justify-between px-6 border-b border-[#1e1e1e] bg-[#0a0a0a] h-12">
        <Logo />
        <span className="text-[11px] font-mono text-[#444]">{time}</span>
      </header>

      {/* Hero */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className="max-w-lg"
        >
          {/* Eyebrow */}
          <div className="inline-flex items-center gap-2 mb-8 px-3 py-1.5 rounded-full border border-[#1e1e1e] bg-[#111]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#F0730A] animate-pulse" />
            <span className="text-[11px] font-mono text-[#555] tracking-widest uppercase">High-Frequency Trading Platform</span>
          </div>

          {/* Title */}
          <h1 className="text-3xl font-black tracking-tight text-[#e8e8e6] mb-4 leading-tight">
            Polyglot Trading<br />
            <span className="text-[#F0730A]">Orchestration</span>
          </h1>

          {/* Description */}
          <p className="text-[13px] font-mono text-[#555] mb-10 leading-relaxed">
            Sub-millisecond market data ingestion, lock-free pre-trade risk, and real-time ML inference across C++, Go, and Python.
          </p>

          {/* CTA */}
          <a
            href="/dashboard"
            className="inline-flex items-center gap-2 px-6 py-3 bg-[#F0730A] text-white text-sm font-bold font-mono rounded-sm hover:bg-[#d9620a] transition-colors"
          >
            Open Dashboard
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3 7h8M8 4l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </a>
        </motion.div>

        {/* Stats row */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.5 }}
          className="flex gap-8 mt-16"
        >
          {[
            { label: 'Risk P99', value: '~75 ns' },
            { label: 'Throughput', value: '10M+ /s' },
            { label: 'Order Build', value: '~8 ns' },
          ].map((s) => (
            <div key={s.label} className="text-center">
              <div className="text-lg font-black font-mono text-[#e8e8e6]">{s.value}</div>
              <div className="text-[10px] font-mono text-[#444] uppercase tracking-widest mt-0.5">{s.label}</div>
            </div>
          ))}
        </motion.div>
      </main>

      {/* Footer */}
      <footer className="px-6 py-3 border-t border-[#1e1e1e] flex items-center justify-between">
        <span className="text-[10px] font-mono text-[#2a2a2a]">C++ · Go · Python · XGBoost</span>
        <span className="text-[10px] font-mono text-[#2a2a2a]">QuantTrade</span>
      </footer>
    </div>
  )
}

