'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowLeft, ChevronDown, ChevronUp, Wifi, WifiOff, LayoutDashboard, Sliders } from 'lucide-react'
import { cn } from '@/lib/utils'

interface NavbarProps {
  price?: number
  symbol?: string
  connected?: boolean
  isCollapsed?: boolean
  onToggleCollapse?: () => void
}

function Logo() {
  return (
    <div className="flex items-center gap-2">
      <div className="w-6 h-6 rounded bg-[#F0730A] flex items-center justify-center font-mono font-extrabold text-white text-xs shadow-md">
        QT
      </div>
      <span className="text-xs font-bold text-white tracking-wide font-mono">QuantTrade</span>
    </div>
  )
}

export function Navbar({
  price,
  symbol = 'SYNTH',
  connected = false,
  isCollapsed = false,
  onToggleCollapse,
}: NavbarProps) {
  const [pathname, setPathname] = useState('/dashboard')
  const [time, setTime] = useState('')

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setPathname(window.location.pathname)
    }
  }, [])

  useEffect(() => {
    const update = () => setTime(new Date().toISOString().slice(11, 19) + ' UTC')
    update()
    const t = setInterval(update, 1000)
    return () => clearInterval(t)
  }, [])

  const isDashboard = pathname === '/dashboard' || pathname === '/dashboard/'

  return (
    <AnimatePresence mode="wait">
      {isDashboard && isCollapsed ? (
        /* Floating mini pill header when collapsed */
        <motion.div
          key="collapsed-nav"
          initial={{ y: -40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -40, opacity: 0 }}
          transition={{ duration: 0.25, ease: 'easeInOut' }}
          className="fixed top-3 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-1.5 rounded-full border border-white/10 bg-[#0a0a0a]/90 backdrop-blur-md shadow-2xl"
        >
          <Logo />
          <div className="w-px h-3 bg-white/10" />
          <div className="flex items-center gap-1.5 text-[11px] font-mono">
            <span className={cn('w-1.5 h-1.5 rounded-full', connected ? 'bg-[#F0730A] animate-pulse' : 'bg-slate-600')} />
            <span className={connected ? 'text-[#F0730A]' : 'text-slate-500'}>
              {connected ? 'LIVE' : 'STANDBY'}
            </span>
          </div>
          {price !== undefined && (
            <>
              <div className="w-px h-3 bg-white/10" />
              <span className="text-xs font-mono font-black text-blue-400">
                {price.toFixed(2)}
              </span>
            </>
          )}
          <button
            onClick={onToggleCollapse}
            className="ml-1 p-1 rounded-full hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
            title="Expand Navbar"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </motion.div>
      ) : (
        /* Full sliding header bar */
        <motion.header
          key="expanded-nav"
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -20, opacity: 0 }}
          transition={{ duration: 0.25, ease: 'easeInOut' }}
          className="sticky top-0 z-50 w-full border-b border-[#1e1e1e] bg-[#0a0a0a]/95 backdrop-blur-md h-12"
        >
          <div className="flex items-center justify-between px-4 h-full">
            {/* Left side */}
            <div className="flex items-center gap-4">
              <a href="/" className="flex items-center gap-1.5 text-slate-400 hover:text-white transition-colors text-xs font-mono">
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Landing Page</span>
              </a>
              <div className="w-px h-4 bg-[#1e1e1e]" />
              <Logo />
            </div>

            {/* Center ticker on dashboard */}
            {isDashboard && price !== undefined && (
              <div className="hidden sm:flex items-center gap-2 px-3 py-1 rounded-md bg-white/[0.03] border border-white/5 text-xs font-mono">
                <span className="text-slate-500 font-semibold">{symbol}</span>
                <span className="text-emerald-400 font-bold">{price.toFixed(2)}</span>
              </div>
            )}

            {/* Right side controls */}
            <div className="flex items-center gap-4">
              {isDashboard && (
                <div className="flex items-center gap-2">
                  <motion.div
                    animate={{ opacity: connected ? [1, 0.3, 1] : 1 }}
                    transition={{ repeat: Infinity, duration: 1.5 }}
                    className={cn('w-2 h-2 rounded-full', connected ? 'bg-[#F0730A]' : 'bg-slate-700')}
                  />
                  <span className={cn('text-[11px] font-mono font-bold', connected ? 'text-[#F0730A]' : 'text-slate-500')}>
                    {connected ? 'LIVE FEED' : 'STANDBY'}
                  </span>
                </div>
              )}

              <span className="text-[11px] font-mono text-slate-500 hidden md:block">{time}</span>

              {!isDashboard && (
                <a
                  href="/dashboard"
                  className="px-3 py-1 rounded-lg bg-[#F0730A] text-white text-xs font-mono font-bold hover:bg-[#ff7e15] transition-all"
                >
                  Dashboard
                </a>
              )}

              {isDashboard && onToggleCollapse && (
                <button
                  onClick={onToggleCollapse}
                  className="p-1.5 rounded-lg border border-white/10 bg-white/5 text-slate-400 hover:text-white hover:bg-white/10 transition-all flex items-center gap-1 text-[10px] font-mono"
                  title="Collapse Navbar"
                >
                  <ChevronUp className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Slide Bar</span>
                </button>
              )}
            </div>
          </div>
        </motion.header>
      )}
    </AnimatePresence>
  )
}
