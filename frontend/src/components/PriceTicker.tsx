"use client";

import { useEffect, useRef, useState } from "react";

interface PriceResp {
  asset: string;
  price: number;
  source: string;
}

const POLL_MS = 2000;

function fmtUsd(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function PriceTicker() {
  const [price, setPrice] = useState<number | null>(null);
  const [dir, setDir] = useState<"up" | "down" | "flat">("flat");
  const [asset, setAsset] = useState("BTC");
  const prev = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const res = await fetch("/api/price", { cache: "no-store" });
        if (!res.ok) return;
        const json: PriceResp = await res.json();
        if (!alive) return;
        setAsset(json.asset);
        if (prev.current !== null) {
          if (json.price > prev.current) setDir("up");
          else if (json.price < prev.current) setDir("down");
        }
        prev.current = json.price;
        setPrice(json.price);
      } catch {
        /* keep last price */
      }
    }
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="ticker">
      <span className="ticker-asset">{asset}/USD</span>
      {price === null ? (
        <span className="ticker-price muted">—</span>
      ) : (
        <span className={`ticker-price ${dir}`} key={price}>
          {fmtUsd(price)}
          <span className="ticker-arrow">
            {dir === "up" ? "▲" : dir === "down" ? "▼" : "·"}
          </span>
        </span>
      )}
      <span className="ticker-live">
        <span className="ticker-live-dot" />
        LIVE
      </span>
    </div>
  );
}
