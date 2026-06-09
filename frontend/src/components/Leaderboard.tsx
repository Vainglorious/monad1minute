"use client";

import { useCallback, useEffect, useState } from "react";
import { formatEther } from "viem";

interface Leader {
  username: string;
  bets: number;
  wins: number;
  wagered: string;
}

interface Props {
  refreshKey: number;
}

const fmt = (wei: string) => Number(formatEther(BigInt(wei))).toFixed(2);

export default function Leaderboard({ refreshKey }: Props) {
  const [leaders, setLeaders] = useState<Leader[] | null>(null);
  const [me, setMe] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/leaderboard", { cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json();
      setLeaders(json.leaders);
      setMe(json.me ?? null);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    load();
    // Other players' bets move the board too, so refresh on a slow poll.
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load, refreshKey]);

  if (!leaders || leaders.length === 0) return null;

  return (
    <div className="card">
      <div className="label-xs">Leaderboard</div>
      <div className="lb">
        <div className="lb-row lb-head">
          <span className="lb-rank">#</span>
          <span className="lb-name">Player</span>
          <span className="lb-num">Bets</span>
          <span className="lb-num">Wins</span>
          <span className="lb-num">Wagered</span>
        </div>
        {leaders.map((l, i) => (
          <div className={`lb-row${l.username === me ? " me" : ""}`} key={l.username}>
            <span className="lb-rank">{i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1}</span>
            <span className="lb-name">
              @{l.username}
              {l.username === me && <span className="lb-you">YOU</span>}
            </span>
            <span className="lb-num">{l.bets}</span>
            <span className="lb-num win">{l.wins}</span>
            <span className="lb-num">{fmt(l.wagered)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
