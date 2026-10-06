/**
 * QuantTrade Platform — Network & API Configuration
 * Production-hardened environment variable & origin resolution
 */

export interface AppConfig {
  apiBaseUrl: string
  wsMarketDataUrl: string
  wsTradesUrl: string
  wsMlPredictionsUrl: string
}

export function getBackendHost(): string {
  // 1. Environment variable (Recommended for Production & Vercel)
  if (process.env.NEXT_PUBLIC_BACKEND_HOST) {
    return process.env.NEXT_PUBLIC_BACKEND_HOST
  }

  if (typeof window === 'undefined') {
    return 'localhost:8081'
  }

  // 2. Query parameter override (for debugging/development only)
  const params = new URLSearchParams(window.location.search)
  const queryBackend = params.get('backend')
  if (queryBackend) {
    try {
      localStorage.setItem('quant_trade_backend_host', queryBackend)
    } catch {}
    return queryBackend
  }

  // 3. Stored override from previous session
  try {
    const saved = localStorage.getItem('quant_trade_backend_host')
    if (saved) return saved
  } catch {}

  // 4. Same-origin fallback (Uses current host & port)
  const hostname = window.location.hostname
  if (hostname && hostname !== 'localhost' && hostname !== '127.0.0.1') {
    return window.location.host
  }

  return 'localhost:8081'
}

export function getAppConfig(): AppConfig {
  const host = getBackendHost()
  const isSecure = typeof window !== 'undefined' && window.location.protocol === 'https:'
  const httpProto = isSecure ? 'https' : 'http'
  const wsProto = isSecure ? 'wss' : 'ws'

  // Clean host to avoid duplicate protocols
  const cleanHost = host.replace(/^https?:\/\//, '').replace(/^wss?:\/\//, '')

  const apiBase = process.env.NEXT_PUBLIC_API_URL || `${httpProto}://${cleanHost}`
  const wsBase = process.env.NEXT_PUBLIC_WS_URL || `${wsProto}://${cleanHost}`

  return {
    apiBaseUrl: apiBase,
    wsMarketDataUrl: `${wsBase}/ws/market-data`,
    wsTradesUrl: `${wsBase}/ws/trades`,
    wsMlPredictionsUrl: `${wsBase}/ws/ml-predictions`,
  }
}
