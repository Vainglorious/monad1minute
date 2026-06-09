"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatEther } from "viem";
import { LiveChartV2, type LiveChartV2Handle } from "@/components/charts/LiveChartV2";
import { useLivePriceFeed } from "@/hooks/useLivePriceFeed";
import {
  BUCKETS,
  derivePhase,
  isExtreme,
  potentialPayoutWei,
  multiplierLabel,
  type Phase,
} from "@/lib/buckets";

interface RoundResp {
  now: number;
  config: {
    betAmount: string;
    bucketMultipliers: string[];
    multiplierScale: string;
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
  basePrice: number | null;
  bucketCounts: number[];
  myBet: { bucket: number; placed: boolean; claimed: boolean } | null;
  balance: string | null;
}

interface Props {
  asset?: string;
  onToast: (msg: string) => void;
  onBalanceChange?: () => void;
}

// Compact price-band labels for the rail (full labels live in lib/buckets).
const SHORT_BAND = [
  "> +0.1%",
  "+.05–.1%",
  "0–+.05%",
  "0–-.05%",
  "-.05–.1%",
  "< -0.1%",
] as const;

const CHART_HEIGHT = 280;

const fmtMon = (wei: string | bigint) => {
  const n = Number(formatEther(typeof wei === "string" ? BigInt(wei) : wei));
  return n.toFixed(2);
};

const fmtUsd = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export default function MarketGame({ asset = "btc", onToast, onBalanceChange }: Props) {
  const [data, setData] = useState<RoundResp | null>(null);
  const [fetchedAtMs, setFetchedAtMs] = useState(0);
  const [nowMs, setNowMs] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inFlightRef = useRef(false);
  // Optimistically-placed bet, kept until the chain read catches up so a
  // background poll doesn't momentarily clear the "YOUR BET" highlight.
  const pendingBetRef = useRef<{ bucket: number; roundId: string } | null>(null);
  // Last round we notified the parent about resolving (refreshes History/balance).
  const notifiedResolvedRef = useRef<string | null>(null);
  // Round we already auto-claimed, so the effect fires once per win.
  const autoClaimedRef = useRef<string | null>(null);

  const chartRef = useRef<LiveChartV2Handle | null>(null);
  const handleLiveTick = useCallback((timeSec: number, value: number) => {
    chartRef.current?.pushTick(timeSec, value);
  }, []);
  const { history, livePrice, dir } = useLivePriceFeed(asset, handleLiveTick);

  const load = useCallback(async () => {
    // Skip if a previous poll is still in flight so requests never pile up
    // (each /api/round hits the RPC; overlapping polls can saturate it).
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const res = await fetch("/api/round", { cache: "no-store" });
      if (!res.ok) return;
      const json: RoundResp = await res.json();
      // Keep the optimistic bet visible until the chain read reflects it (or the
      // round advances), so polling never flickers the highlight off.
      const pending = pendingBetRef.current;
      if (pending) {
        if (json.round?.roundId !== pending.roundId || json.myBet?.placed) {
          pendingBetRef.current = null;
        } else {
          json.myBet = { bucket: pending.bucket, placed: true, claimed: false };
        }
      }
      setData(json);
      setFetchedAtMs(Date.now());
    } catch {
      /* transient; next poll retries */
    } finally {
      inFlightRef.current = false;
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

  // When a round resolves, nudge the parent once so History/Leaderboard/balance
  // refetch — otherwise past bets sit on "pending" until a manual page refresh.
  useEffect(() => {
    const r = data?.round;
    if (r?.resolved && notifiedResolvedRef.current !== r.roundId) {
      notifiedResolvedRef.current = r.roundId;
      onBalanceChange?.();
    }
  }, [data, onBalanceChange]);

  // Auto-claim: when the resolved round is a win for us, claim it without a tap.
  // Fires once per round; on failure the manual Claim button appears as a retry.
  useEffect(() => {
    const r = data?.round;
    const bet = data?.myBet;
    if (!r?.resolved || !bet?.placed || bet.claimed) return;
    if (bet.bucket !== r.winner) return;
    if (autoClaimedRef.current === r.roundId) return;
    autoClaimedRef.current = r.roundId;
    claim(r.roundId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  async function placeBet(bucket: number) {
    if (busy) return;
    setError("");
    setBusy(true);
    // Optimistic: reflect the bet on the FE immediately (the tx + confirmation
    // can take a few seconds). Reverted below if the request fails.
    const rid = data?.round?.roundId;
    if (rid) pendingBetRef.current = { bucket, roundId: rid };
    setData((prev) =>
      prev ? { ...prev, myBet: { bucket, placed: true, claimed: false } } : prev,
    );
    try {
      const res = await fetch("/api/bet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bucket }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Bet failed.");
        pendingBetRef.current = null;
        setData((prev) => (prev ? { ...prev, myBet: null } : prev)); // revert
      } else {
        onToast(`Bet placed on ${BUCKETS[bucket].key} 🎯`);
        onBalanceChange?.();
        await load();
      }
    } catch {
      setError("Network error.");
      pendingBetRef.current = null;
      setData((prev) => (prev ? { ...prev, myBet: null } : prev)); // revert
    } finally {
      setBusy(false);
    }
  }

  async function claim(roundId: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roundId }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Claim failed.");
      } else {
        onToast(`Claimed ${fmtMon(json.payout)} MON 🏆`);
        onBalanceChange?.();
        await load();
      }
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return (
      <div className="card market-game">
        <div className="spinner" />
      </div>
    );
  }

  const { config, round, basePrice, bucketCounts, myBet } = data;
  const stake = BigInt(config.betAmount);
  const mults = config.bucketMultipliers.map((m) => BigInt(m));
  const scale = BigInt(config.multiplierScale);

  // server-anchored current time (seconds), advanced by local elapsed
  const elapsed = fetchedAtMs ? (Math.max(nowMs, fetchedAtMs) - fetchedAtMs) / 1000 : 0;
  const effectiveNow = data.now + elapsed;
  const phase: Phase = derivePhase(round, effectiveNow);
  const secondsLeft = round ? Math.max(0, Math.ceil(round.lockTime - effectiveNow)) : 0;

  const alreadyBet = !!myBet?.placed;
  const won =
    phase === "resolved" && round && myBet?.placed && myBet.bucket === round.winner;
  const canClaim = won && myBet && !myBet.claimed;
  // Signing + mining takes ~3-6s; the server also rejects inside a 3s margin.
  // Stop offering bets that can't land instead of letting them fail late.
  const tooLate = phase === "open" && secondsLeft <= 6;
  const bettingOpen = phase === "open" && !alreadyBet && !tooLate;
  const frozen = phase === "locked" || phase === "resolved";
  // After a bet (or once resolved), dim everything that isn't the player's pick / winner.
  const focused = alreadyBet || phase === "resolved";

  const renderBucket = (bucket: (typeof BUCKETS)[number]) => {
    const count = bucketCounts[bucket.id] ?? 0;
    const payout = potentialPayoutWei(bucket.id, stake, mults, scale);
    const multX = mults[bucket.id] != null ? multiplierLabel(mults[bucket.id], scale) : "";
    const mine = !!myBet?.placed && myBet.bucket === bucket.id;
    const winner = phase === "resolved" && round?.winner === bucket.id;
    const up = bucket.id <= 2;
    const dim = focused && !mine && !winner;
    return (
      <button
        key={bucket.id}
        className={
          `rail-bucket ${up ? "up" : "dn"}` +
          (isExtreme(bucket.id) ? " extreme" : "") +
          (mine ? " mine" : "") +
          (winner ? " winner" : "") +
          (dim ? " dim" : "")
        }
        disabled={!bettingOpen || busy}
        onClick={() => placeBet(bucket.id)}
        title={`${bucket.label} · pays ${fmtMon(payout)} MON`}
      >
        <span className="rb-key">
          {up ? "▲" : "▼"} {bucket.key} <span className="rb-mult">{multX}</span>
        </span>
        <span className="rb-band">{SHORT_BAND[bucket.id]}</span>
        <span className="rb-meta">{count} bet{count === 1 ? "" : "s"}</span>
        {mine && <span className="rb-tag">{busy ? "…" : "YOU"}</span>}
        {winner && <span className="rb-tag win">WIN</span>}
      </button>
    );
  };

  return (
    <div className="card market-game">
      <div className="bet-head">
        <div className="label-xs">
          {round ? `Round #${round.roundId}` : "Waiting for next round"}
        </div>
        <PhaseBadge phase={phase} secondsLeft={secondsLeft} duration={config.bettingDuration} />
      </div>

      <div className="mg-row">
        <div className="mg-chart">
          <div className="chart-head">
            <div className="label-xs">
              <span className="chart-live-dot" />
              {asset.toUpperCase()}/USD
            </div>
            <div className={`chart-price ${dir}`} key={livePrice ?? "na"}>
              {livePrice != null ? fmtUsd(livePrice) : "—"}
              {livePrice != null && dir !== "flat" && (
                <span className="chart-price-arrow">{dir === "up" ? "▲" : "▼"}</span>
              )}
            </div>
          </div>
          <LiveChartV2
            ref={chartRef}
            data={history}
            height={CHART_HEIGHT}
            lineColor="#2e5cff"
            areaTopColor="rgba(46, 92, 255, 0.25)"
            areaBottomColor="rgba(46, 92, 255, 0)"
            asset={asset}
            frozen={frozen}
            targetPrice={basePrice}
            targetLabel="BASE"
          />
        </div>

        <div className="bucket-rail">
          {BUCKETS.slice(0, 3).map(renderBucket)}
          <div className="base-chip">
            BASE{basePrice != null ? ` ${fmtUsd(basePrice)}` : ""}
          </div>
          {BUCKETS.slice(3, 6).map(renderBucket)}
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      {phase === "open" && alreadyBet && (
        <div className="bet-status muted">
          You bet {BUCKETS[myBet!.bucket].key}. Locks in {secondsLeft}s — good luck!
        </div>
      )}
      {tooLate && !alreadyBet && (
        <div className="bet-status muted">Too late this round — next one starts soon.</div>
      )}
      {phase === "locked" && (
        <div className="bet-status muted">Locked — waiting for the result…</div>
      )}
      {phase === "resolved" && round && (
        <div className="bet-status">
          {alreadyBet ? (
            won ? (
              <span className="win-text">You won! Bucket {BUCKETS[round.winner].key} hit.</span>
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

      {canClaim && round && busy && (
        <div className="bet-status muted">
          Claiming {fmtMon(round.payoutPerWinner)} MON…
        </div>
      )}
      {canClaim && round && !busy && error && (
        <button className="btn" onClick={() => claim(round.roundId)}>
          Retry claim {fmtMon(round.payoutPerWinner)} MON
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
