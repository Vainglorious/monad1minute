"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatEther } from "viem";
import {
  BUCKETS,
  derivePhase,
  isExtreme,
  potentialPayoutWei,
  type Phase,
} from "@/lib/buckets";

interface RoundResp {
  now: number;
  config: {
    betAmount: string;
    bucketMultipliers: string[];
    bettingDuration: number;
  };
  round: {
    roundId: string;
    startTime: number;
    lockTime: number;
    resolved: boolean;
    winner: number;
    betCount: number;
    winnerCount: number;
    payoutPerWinner: string;
  } | null;
  bucketCounts: number[];
  myBet: { bucket: number; placed: boolean; claimed: boolean } | null;
  balance: string | null;
}

interface Props {
  onToast: (msg: string) => void;
  onBalanceChange?: () => void;
}

const fmt = (wei: string | bigint) => {
  const n = Number(formatEther(typeof wei === "string" ? BigInt(wei) : wei));
  return n.toFixed(2);
};

export default function Betting({ onToast, onBalanceChange }: Props) {
  const [data, setData] = useState<RoundResp | null>(null);
  const [fetchedAtMs, setFetchedAtMs] = useState(0);
  const [nowMs, setNowMs] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/round", { cache: "no-store" });
      if (!res.ok) return;
      const json: RoundResp = await res.json();
      setData(json);
      setFetchedAtMs(Date.now());
    } catch {
      /* transient; next poll retries */
    }
  }, []);

  useEffect(() => {
    load();
    pollRef.current = setInterval(load, 1500);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [load]);

  // local 1s tick for the countdown
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (!data) {
    return (
      <div className="card">
        <div className="spinner" />
      </div>
    );
  }

  const { config, round, bucketCounts, myBet } = data;
  const stake = BigInt(config.betAmount);
  const bucketMultipliers = config.bucketMultipliers.map((m) => BigInt(m));

  // server-anchored current time (seconds), advanced by local elapsed
  const elapsed = fetchedAtMs ? (Math.max(nowMs, fetchedAtMs) - fetchedAtMs) / 1000 : 0;
  const effectiveNow = data.now + elapsed;
  const phase: Phase = derivePhase(round, effectiveNow);
  const secondsLeft = round ? Math.max(0, Math.ceil(round.lockTime - effectiveNow)) : 0;

  const alreadyBet = !!myBet?.placed;
  const won =
    phase === "resolved" && round && myBet?.placed && myBet.bucket === round.winner;
  const canClaim = won && myBet && !myBet.claimed;

  async function placeBet(bucket: number) {
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/bet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bucket }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Bet failed.");
      } else {
        onToast(`Bet placed on ${BUCKETS[bucket].key} 🎯`);
        onBalanceChange?.();
        await load();
      }
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  async function claim() {
    if (busy || !round) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roundId: round.roundId }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Claim failed.");
      } else {
        onToast(`Claimed ${fmt(json.payout)} MON 🏆`);
        onBalanceChange?.();
        await load();
      }
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  const bettingOpen = phase === "open" && !alreadyBet;

  return (
    <div className="card bet-card">
      <div className="bet-head">
        <div className="label-xs">
          {round ? `Round #${round.roundId}` : "Waiting for next round"}
        </div>
        <PhaseBadge phase={phase} secondsLeft={secondsLeft} duration={config.bettingDuration} />
      </div>

      <div className="bet-sub muted">
        Stake {fmt(stake)} MON · BTC/USD move over {config.bettingDuration}s · win 2.8×–20×
      </div>

      <div className="bucket-grid">
        {BUCKETS.map((b) => {
          const count = bucketCounts[b.id] ?? 0;
          const payout = potentialPayoutWei(b.id, stake, bucketMultipliers);
          const mine = myBet?.placed && myBet.bucket === b.id;
          const winner = phase === "resolved" && round?.winner === b.id;
          const disabled = !bettingOpen || busy;
          return (
            <button
              key={b.id}
              className={`bucket${mine ? " mine" : ""}${winner ? " winner" : ""}${
                isExtreme(b.id) ? " extreme" : ""
              }`}
              disabled={disabled}
              onClick={() => placeBet(b.id)}
            >
              <span className="bucket-key">{b.key}</span>
              <span className="bucket-label">{b.label}</span>
              <span className="bucket-meta">
                {fmt(payout)} MON · {count} bet{count === 1 ? "" : "s"}
              </span>
              {mine && <span className="bucket-tag">YOUR BET</span>}
              {winner && <span className="bucket-tag win">WINNER</span>}
            </button>
          );
        })}
      </div>

      {error && <div className="error">{error}</div>}

      {phase === "open" && alreadyBet && (
        <div className="bet-status muted">
          You bet {BUCKETS[myBet!.bucket].key}. Locks in {secondsLeft}s — good luck!
        </div>
      )}
      {phase === "locked" && (
        <div className="bet-status muted">Locked — waiting for the result…</div>
      )}
      {phase === "resolved" && round && (
        <div className="bet-status">
          {alreadyBet ? (
            won ? (
              <span className="win-text">
                You won! Bucket {BUCKETS[round.winner].key} hit.
              </span>
            ) : (
              <span className="muted">
                Bucket {BUCKETS[round.winner].key} won this round. Better luck next minute.
              </span>
            )
          ) : (
            <span className="muted">Bucket {BUCKETS[round.winner].key} won this round.</span>
          )}
          <div className="muted next-round">Next round starting soon…</div>
        </div>
      )}

      {canClaim && (
        <button className="btn" disabled={busy} onClick={claim}>
          {busy ? "Claiming…" : `Claim ${fmt(round!.payoutPerWinner)} MON`}
        </button>
      )}
      {won && myBet?.claimed && <div className="bet-status muted">Winnings claimed ✓</div>}
    </div>
  );
}

function PhaseBadge({
  phase,
  secondsLeft,
  duration,
}: {
  phase: Phase;
  secondsLeft: number;
  duration: number;
}) {
  if (phase === "open") {
    const pct = Math.max(0, Math.min(100, (secondsLeft / Math.max(1, duration)) * 100));
    return (
      <div className="phase open">
        <span className="phase-dot" />
        {secondsLeft}s
        <span className="phase-bar">
          <span style={{ width: `${pct}%` }} />
        </span>
      </div>
    );
  }
  if (phase === "locked") return <div className="phase locked">Locked</div>;
  if (phase === "resolved") return <div className="phase resolved">Resolved</div>;
  return <div className="phase">—</div>;
}
