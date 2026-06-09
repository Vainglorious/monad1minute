"use client";

import { useCallback, useEffect, useState } from "react";
import { formatEther } from "viem";
import { BUCKETS } from "@/lib/buckets";

interface HistItem {
  roundId: string;
  bucket: number;
  amount: string;
  txHash: string;
  claimed: boolean;
  createdAt: string;
  resolved: boolean;
  winner: number | null;
  won: boolean | null;
  payout: string | null;
}

interface Props {
  refreshKey: number;
}

const fmt = (wei: string) => Number(formatEther(BigInt(wei))).toFixed(2);

export default function History({ refreshKey }: Props) {
  const [items, setItems] = useState<HistItem[] | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/history", { cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json();
      setItems(json.bets);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  if (!items || items.length === 0) return null;

  return (
    <div className="card">
      <div className="label-xs">Your bets</div>
      <div className="hist">
        {items.map((it) => {
          const outcome = !it.resolved
            ? "pending"
            : it.won
              ? "won"
              : "lost";
          return (
            <div className="hist-row" key={`${it.roundId}-${it.txHash}`}>
              <span className="hist-round">#{it.roundId}</span>
              <span className="hist-bucket">{BUCKETS[it.bucket].key}</span>
              <span className="hist-amount">{fmt(it.amount)} MON</span>
              <span className={`hist-outcome ${outcome}`}>
                {outcome === "pending"
                  ? "Pending"
                  : it.won
                    ? `Won ${it.payout ? fmt(it.payout) : ""}${it.claimed ? " ✓" : " · claim"}`
                    : "Lost"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
