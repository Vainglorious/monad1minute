// Coinbase 1-minute candle helpers — mirrors frontend/src/lib/coinbase.ts so the
// bot settles on EXACTLY the price the chart draws as the BASE line:
//   open  = candle open at round.startTime
//   close = candle open at round.lockTime
// Settlement is therefore publicly verifiable against Coinbase's candles.

const HOST = process.env.COINBASE_REST_HOST ?? 'https://api.exchange.coinbase.com'

// Candle row: [ time(sec), low, high, open, close, volume ], most-recent first.

/** Fetch the latest Coinbase 1-minute candles, or null if unreachable. */
export async function fetchCandles(asset = 'BTC') {
  try {
    const product = `${asset.toUpperCase()}-USD`
    const res = await fetch(`${HOST}/products/${product}/candles?granularity=60`, {
      signal: AbortSignal.timeout(4500),
      headers: { 'user-agent': 'pricebetgame-operator' },
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

/**
 * Open price of the 1-minute candle bucket containing `unixSec` (bucket spans
 * [time, time+60)). Falls back to the most recent candle at or before
 * `unixSec`. Returns null if no usable candle is found.
 */
export function pickOpenAt(candles, unixSec) {
  let exact = null
  let prior = null
  for (const c of candles) {
    const t = c[0]
    if (unixSec >= t && unixSec < t + 60) {
      exact = c
      break
    }
    if (t <= unixSec && (prior == null || t > prior[0])) prior = c
  }
  const chosen = exact ?? prior
  const open = chosen ? Number(chosen[3]) : NaN
  return Number.isFinite(open) ? open : null
}

/**
 * Open/close for a round window, with retries (Coinbase hiccups shouldn't make
 * us settle garbage). Returns { open, close } or null after all retries fail.
 */
export async function roundPrices(startTime, lockTime, asset = 'BTC', tries = 3) {
  for (let i = 0; i < tries; i++) {
    const candles = await fetchCandles(asset)
    if (candles) {
      const open = pickOpenAt(candles, Number(startTime))
      const close = pickOpenAt(candles, Number(lockTime))
      if (open != null && close != null) return { open, close }
    }
    if (i < tries - 1) await new Promise((r) => setTimeout(r, 2000))
  }
  return null
}
