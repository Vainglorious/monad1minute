import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ASSET = (process.env.PRICE_ASSET ?? "BTC").toUpperCase();

interface Source {
  name: string;
  url: string;
  parse: (j: any) => number;
}

// Ordered by global reachability; Binance global is geo-blocked (451) from some
// regions, so Coinbase / Binance.US come first.
const SOURCES: Source[] = [
  {
    name: "coinbase",
    url: `https://api.exchange.coinbase.com/products/${ASSET}-USD/ticker`,
    parse: (j) => Number(j.price),
  },
  {
    name: "binanceus",
    url: `https://api.binance.us/api/v3/ticker/price?symbol=${ASSET}USDT`,
    parse: (j) => Number(j.price),
  },
  {
    name: "binance",
    url: `https://api.binance.com/api/v3/ticker/price?symbol=${ASSET}USDT`,
    parse: (j) => Number(j.price),
  },
];

// Honor an explicit preference if set.
const preferred = process.env.PRICE_SOURCE;
const ordered = preferred
  ? [...SOURCES].sort((a, b) => (a.name === preferred ? -1 : b.name === preferred ? 1 : 0))
  : SOURCES;

export async function GET() {
  for (const src of ordered) {
    try {
      const res = await fetch(src.url, {
        signal: AbortSignal.timeout(4000),
        headers: { "user-agent": "monad1minute/1.0" },
        cache: "no-store",
      });
      if (!res.ok) continue;
      const price = src.parse(await res.json());
      if (Number.isFinite(price) && price > 0) {
        return NextResponse.json(
          { asset: ASSET, price, source: src.name },
          { headers: { "cache-control": "no-store" } },
        );
      }
    } catch {
      /* try next source */
    }
  }
  return NextResponse.json({ error: "Price unavailable." }, { status: 502 });
}
