/**
 * History seed for the live chart — Coinbase candles, server-side.
 *
 * Uses Coinbase Exchange BTC-USD so the chart matches the operator's settlement
 * price (PRICE_SOURCE=coinbase). Public REST, no key.
 *
 * GET /api/crypto-price-history?symbol=BTC&minutes=60
 * Response: { data: [{ time: <unix seconds>, value: <number> }] }
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Coinbase Exchange REST. Override with COINBASE_REST_HOST if needed.
const HOST = process.env.COINBASE_REST_HOST ?? "https://api.exchange.coinbase.com";

// Coinbase candles endpoint returns at most 300 buckets per request.
const MAX_BUCKETS = 300;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const symbol = (url.searchParams.get("symbol") ?? "BTC").toUpperCase();
  const minutes = Math.min(
    MAX_BUCKETS,
    Math.max(1, Number(url.searchParams.get("minutes") ?? "60")),
  );
  const product = `${symbol}-USD`;

  try {
    // 1-minute candles (granularity in seconds). Returns most-recent-first.
    const api = `${HOST}/products/${product}/candles?granularity=60`;
    const res = await fetch(api, {
      signal: AbortSignal.timeout(4500),
      headers: { "user-agent": "monad1minute/1.0" },
      cache: "no-store",
    });
    if (res.ok) {
      // Each row: [ time(sec), low, high, open, close, volume ]
      const raw = (await res.json()) as Array<[number, number, number, number, number, number]>;
      const data = raw
        .slice(0, minutes) // most recent `minutes` buckets
        .map(([timeSec, , , , close]) => ({
          time: Math.floor(timeSec),
          value: Number(close),
        }))
        .filter((p) => Number.isFinite(p.time) && Number.isFinite(p.value))
        .sort((a, b) => a.time - b.time);
      if (data.length > 0) {
        return NextResponse.json(
          { data, source: HOST },
          { headers: { "cache-control": "no-store" } },
        );
      }
    }
  } catch {
    /* fall through to error response */
  }
  return NextResponse.json({ data: [], error: "history unavailable" }, { status: 502 });
}
