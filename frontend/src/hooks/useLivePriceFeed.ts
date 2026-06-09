"use client";

import { useEffect, useRef, useState } from "react";
import { interpolateSeriesData } from "@/lib/interpolateSeriesData";

// Continuous BTC/USD feed for the live market chart.
//   1. Seed the history line from our Coinbase-candles BFF (last ~1h).
//   2. Stream live ticks over Coinbase's `ticker` WebSocket (browser-direct).
// Coinbase BTC-USD matches the operator's settlement price (PRICE_SOURCE=coinbase),
// so the chart and round settlement agree. Override the WS host with
// NEXT_PUBLIC_COINBASE_WS if needed.
const WS_HOST = process.env.NEXT_PUBLIC_COINBASE_WS ?? "wss://ws-feed.exchange.coinbase.com";
const SEED_MINUTES = 60;

export function useLivePriceFeed(
  asset: string,
  onLiveTick?: (timeSec: number, value: number) => void,
) {
  const [history, setHistory] = useState<{ time: number; value: number }[]>([]);
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [dir, setDir] = useState<"up" | "down" | "flat">("flat");
  const prevPriceRef = useRef<number | null>(null);

  const onLiveTickRef = useRef(onLiveTick);
  useEffect(() => {
    onLiveTickRef.current = onLiveTick;
  }, [onLiveTick]);

  const assetUpper = asset.toUpperCase();
  const product = `${assetUpper}-USD`;

  // ── history seed ──────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/crypto-price-history?symbol=${assetUpper}&minutes=${SEED_MINUTES}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const json = await res.json();
        const raw: { time: number; value: number }[] = Array.isArray(json?.data)
          ? json.data
          : [];
        if (cancelled) return;
        setHistory(interpolateSeriesData(raw.slice().sort((a, b) => a.time - b.time)));
      } catch {
        /* leave empty; live ticks still populate the chart */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [assetUpper]);

  // ── live ticks via Coinbase `ticker` WS, with REST fallback ───────
  // Coinbase caps unauthenticated ticker subscriptions per IP and answers with
  // an in-band {type:"error"} frame (socket stays open!). We must close those
  // zombies ourselves, back off on reconnect, and keep the price moving via
  // REST polling whenever the socket is silent.
  useEffect(() => {
    let ws: WebSocket | null = null;
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let lastStateMs = 0;
    let lastTickMs = 0;
    let attempts = 0;

    const handleTrade = (val: number, tMs: number) => {
      if (!Number.isFinite(val) || !Number.isFinite(tMs)) return;
      lastTickMs = Date.now();
      // Fast path: straight into the chart, no React re-render.
      onLiveTickRef.current?.(Math.floor(tMs / 1000), val);
      // Slow path: throttle the header price to ~5 Hz, with up/down direction.
      if (tMs - lastStateMs >= 200) {
        lastStateMs = tMs;
        const prev = prevPriceRef.current;
        if (prev != null) {
          if (val > prev) setDir("up");
          else if (val < prev) setDir("down");
        }
        prevPriceRef.current = val;
        setLivePrice(val);
      }
    };

    const connect = () => {
      if (cancelled) return;
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
      ws = new WebSocket(WS_HOST);
      ws.onopen = () => {
        // Coinbase requires an explicit subscribe before any ticks flow.
        ws?.send(
          JSON.stringify({
            type: "subscribe",
            product_ids: [product],
            channels: ["ticker"],
          }),
        );
      };
      ws.onmessage = (ev) => {
        if (document.visibilityState === "hidden") return;
        try {
          const msg = JSON.parse(ev.data);
          // { type: 'ticker', price: '...', time: '2026-...Z' }
          if (msg.type === "ticker" && msg.price) {
            attempts = 0; // healthy — reset backoff
            handleTrade(parseFloat(msg.price), msg.time ? Date.parse(msg.time) : Date.now());
          } else if (msg.type === "error") {
            // e.g. "subscription limit reached" — close the zombie so it frees
            // the per-IP slot; onclose schedules a backed-off retry.
            try {
              ws?.close();
            } catch {
              /* ignore */
            }
          }
        } catch {
          /* skip malformed frame */
        }
      };
      ws.onclose = () => {
        if (cancelled) return;
        attempts += 1;
        const delay = Math.min(30_000, 1500 * 2 ** Math.min(attempts, 4));
        reconnectTimer = setTimeout(connect, delay);
      };
      ws.onerror = () => {
        /* onclose fires next and reconnects */
      };
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        if (!ws || ws.readyState === WebSocket.CLOSED) connect();
      } else {
        try {
          ws?.close();
        } catch {
          /* ignore */
        }
      }
    };

    // REST fallback: if the socket has been silent for >6s, poll the last 1-min
    // candle close (server-side route, no CORS/limits) every 4s so the header
    // price and chart never freeze even when WS subscriptions are capped.
    const fallbackTimer = setInterval(async () => {
      if (cancelled || document.visibilityState === "hidden") return;
      if (Date.now() - lastTickMs < 6000) return;
      try {
        const res = await fetch(`/api/crypto-price-history?symbol=${assetUpper}&minutes=2`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const json = await res.json();
        const pts: { time: number; value: number }[] = Array.isArray(json?.data) ? json.data : [];
        const last = pts[pts.length - 1];
        if (last && Number.isFinite(last.value)) handleTrade(last.value, Date.now());
      } catch {
        /* keep trying */
      }
    }, 4000);

    connect();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      clearInterval(fallbackTimer);
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    };
  }, [product, assetUpper]);

  return { history, livePrice, dir };
}
