/**
 * History seed for the live chart — Binance klines, server-side.
 *
 * Replaces the source project's Polymarket residential-proxy version. Binance's
 * global endpoint geoblocks some server regions (US), so we try Binance.US
 * first, then Binance global. Public REST, no key.
 *
 * GET /api/crypto-price-history?symbol=BTC&minutes=60
 * Response: { data: [{ time: <unix seconds>, value: <number> }] }
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HOSTS = [
  process.env.BINANCE_REST_HOST, // optional override
  "https://api.binance.us",
  "https://api.binance.com",
].filter(Boolean) as string[];

export async function GET(request: Request) {
  const url = new URL(request.url);
  const symbol = (url.searchParams.get("symbol") ?? "BTC").toUpperCase();
  const minutes = Math.min(1000, Math.max(1, Number(url.searchParams.get("minutes") ?? "60")));
  const pair = `${symbol}USDT`;

  for (const host of HOSTS) {
    try {
      const api =
        `${host}/api/v3/klines?symbol=${pair}` +
        `&interval=1m&limit=${minutes}`;
      const res = await fetch(api, {
        signal: AbortSignal.timeout(4500),
        headers: { "user-agent": "monad1minute/1.0" },
        cache: "no-store",
      });
      if (!res.ok) continue;
      const raw = (await res.json()) as Array<[number, string, string, string, string, ...unknown[]]>;
      const data = raw
        .map(([openMs, , , , close]) => ({
          time: Math.floor(openMs / 1000),
          value: parseFloat(close),
        }))
        .filter((p) => Number.isFinite(p.time) && Number.isFinite(p.value));
      if (data.length > 0) {
        return NextResponse.json(
          { data, source: host },
          { headers: { "cache-control": "no-store" } },
        );
      }
    } catch {
      /* try next host */
    }
  }
  return NextResponse.json({ data: [], error: "history unavailable" }, { status: 502 });
}
