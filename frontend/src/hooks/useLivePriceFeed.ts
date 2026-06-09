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

  // ── live ticks via Coinbase `ticker` WS ───────────────────────────
  useEffect(() => {
    let ws: WebSocket | null = null;
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let lastStateMs = 0;

    const handleTrade = (val: number, tMs: number) => {
      if (!Number.isFinite(val) || !Number.isFinite(tMs)) return;
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
            handleTrade(parseFloat(msg.price), msg.time ? Date.parse(msg.time) : Date.now());
          }
        } catch {
          /* skip malformed frame */
        }
      };
      ws.onclose = () => {
        if (cancelled) return;
        reconnectTimer = setTimeout(connect, 1500);
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

    connect();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    };
  }, [product]);

  return { history, livePrice, dir };
}
