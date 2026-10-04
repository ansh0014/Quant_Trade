"use client"

import { useEffect } from "react"
import { motion, useSpring, useTransform } from "framer-motion"
import "./motion-loading-fill-text-utils/index.css"

function useFillProgress() {
  const progress = useSpring(0, { stiffness: 45, damping: 15 })

  useEffect(() => {
    const id = setInterval(() => {
      const current = progress.get()
      if (current >= 1) {
        progress.set(0)
      } else {
        const next = Math.min(1, current + 0.15 + Math.random() * 0.15)
        progress.set(next)
      }
    }, 400)
    return () => clearInterval(id)
  }, [progress])

  return progress
}

export function LoadingFillText({ label = "CONNECTING" }: { label?: string }) {
  const progress = useFillProgress()
  const clipPath = useTransform(progress, [0, 1], ["inset(0 100% 0 0)", "inset(0 0% 0 0)"])

  return (
    <div className="fill-text-container">
      <div className="fill-text-stack">
        <div className="fill-text fill-text-bg" aria-hidden>
          {label}
        </div>
        <motion.div className="fill-text fill-text-fill" style={{ clipPath }}>
          {label}
        </motion.div>
      </div>
    </div>
  )
}

export default LoadingFillText

