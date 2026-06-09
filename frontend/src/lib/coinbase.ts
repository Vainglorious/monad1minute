// Coinbase BTC-USD price helpers (server-side).
// Same source as the live chart (useLivePriceFeed) and the operator's settlement,
// so the round's BASE line and the settlement reference are one and the same.

const HOST = process.env.COINBASE_REST_HOST ?? "https://api.exchange.coinbase.com";

// Coinbase candle row: [ time(sec), low, high, open, close, volume ], most-recent first.
export type Candle = [number, number, number, number, number, number];

/** Fetch the latest Coinbase 1-minute candles, or null if unreachable. */
export async function fetchCoinbaseCandles(asset = "BTC"): Promise<Candle[] | null> {
  try {
    const product = `${asset.toUpperCase()}-USD`;
    const res = await fetch(`${HOST}/products/${product}/candles?granularity=60`, {
      signal: AbortSignal.timeout(4500),
      headers: { "user-agent": "monad1minute/1.0" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as Candle[];
  } catch {
    return null;
  }
}

/**
 * Pure: open price of the 1-minute candle bucket containing `unixSec`
 * (bucket spans [time, time+60)). Falls back to the most recent candle at or
 * before `unixSec` when the exact bucket isn't present yet. Returns null if no
 * usable candle is found.
 */
export function pickOpenAt(candles: Candle[], unixSec: number): number | null {
  let exact: Candle | null = null;
  let prior: Candle | null = null;
  for (const c of candles) {
    const t = c[0];
    if (unixSec >= t && unixSec < t + 60) {
      exact = c;
      break;
    }
    if (t <= unixSec && (prior == null || t > prior[0])) prior = c;
  }
  const chosen = exact ?? prior;
  const open = chosen ? Number(chosen[3]) : NaN;
  return Number.isFinite(open) ? open : null;
}

/**
 * Open price of the Coinbase 1-minute candle covering `unixSec`. Returns null
 * if Coinbase is unreachable so callers can degrade gracefully (no BASE line).
 */
export async function coinbaseOpenAt(unixSec: number, asset = "BTC"): Promise<number | null> {
  const candles = await fetchCoinbaseCandles(asset);
  return candles ? pickOpenAt(candles, unixSec) : null;
}
