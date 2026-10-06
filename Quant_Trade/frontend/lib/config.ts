/**
 * QuantTrade Platform — Network & API Configuration
 * Supports dynamic resolution for local development, remote laptops,
 * and Cloud Kubernetes (DigitalOcean / AWS / GCP) deployments.
 */

export interface AppConfig {
  apiBaseUrl: string
  wsMarketDataUrl: string
  wsTradesUrl: string
  wsMlPredictionsUrl: string
}

export function getBackendHost(): string {
  if (typeof window === 'undefined') {
    return process.env.NEXT_PUBLIC_BACKEND_HOST || 'localhost:8081'
  }

  // 1. Check URL query override (e.g. ?backend=165.227.12.34:8081 or ?backend=api.quanttrade.io)
  const params = new URLSearchParams(window.location.search)
  const queryBackend = params.get('backend')
  if (queryBackend) {
    try {
      localStorage.setItem('quant_trade_backend_host', queryBackend)
    } catch {}
    return queryBackend
  }

  // 2. Check localStorage saved override
  try {
    const saved = localStorage.getItem('quant_trade_backend_host')
    if (saved) return saved
  } catch {}

  // 3. Environment variable override
  if (process.env.NEXT_PUBLIC_BACKEND_HOST) {
    return process.env.NEXT_PUBLIC_BACKEND_HOST
  }

  // 4. Auto-detect if opened on remote laptop pointing to cloud/server
  if (typeof window !== 'undefined') {
    const host = window.location.host
    if (host && !host.startsWith('localhost') && !host.startsWith('127.0.0.1')) {
      // Use standard host (with port if specified in browser address bar)
      return host
    }
  }

  return 'localhost:8081'
}

export function getAppConfig(): AppConfig {
  const host = getBackendHost()
  const isSecure = typeof window !== 'undefined' && window.location.protocol === 'https:'
  const httpProto = isSecure ? 'https' : 'http'
  const wsProto = isSecure ? 'wss' : 'ws'

  // If host already contains protocol, strip it
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
