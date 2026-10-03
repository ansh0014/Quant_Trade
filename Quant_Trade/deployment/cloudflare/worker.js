/**
 * QuantTrade Platform — Cloudflare Edge Proxy
 *
 * This Worker generates NO data. It only forwards requests (HTTP + WebSocket)
 * to your REAL Go backend, whose public URL is set in the BACKEND_URL variable
 * (see wrangler.toml). If BACKEND_URL is not set or unreachable, it returns
 * 503 so the dashboard shows "Backend Offline" instead of fake numbers.
 *
 * Routes forwarded to the real backend:
 *   /ws/market-data, /ws/trades, /ws/ml-predictions, /api/benchmarks, ...
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  })
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS })
    }

    if (url.pathname === '/health') {
      return json({ worker: 'ok', backend_configured: Boolean(env.BACKEND_URL) })
    }

    if (!env.BACKEND_URL) {
      return json({ error: 'backend_not_configured', message: 'BACKEND_URL is not set' }, 503)
    }

    // Forward to the real backend, keeping path, query string and WebSocket upgrade.
    const target = new URL(url.pathname + url.search, env.BACKEND_URL)
    try {
      const upstream = await fetch(new Request(target.toString(), request))
      if (request.headers.get('Upgrade') === 'websocket') return upstream
      const headers = new Headers(upstream.headers)
      for (const [k, v] of Object.entries(CORS)) headers.set(k, v)
      return new Response(upstream.body, { status: upstream.status, headers })
    } catch {
      return json({ error: 'backend_unreachable' }, 503)
    }
  },
}
