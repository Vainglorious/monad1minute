// Serverless operator: one idempotent "tick" that drives the betting cycle.
//
// Triggered every ~60s by Vercel Cron (see vercel.json) hitting
// /api/operator/tick. On-chain round state is the source of truth, so each tick
// is self-healing: resolve the active round if its lock time has passed, then
// start the next one. A crashed tick simply continues on the following call.
//
// Settlement price comes from Coinbase 1-minute candles (the same source as the
// chart's BASE line), so settlement is publicly verifiable. Open = candle open
// at startTime, close = candle open at lockTime.

import { type Hex } from "viem";
import { publicClient } from "./monad";
import {
  getCurrentRoundId,
  getRound,
  sendStartRound,
  sendResolveRound,
} from "./contract";
import { fetchCoinbaseCandles, pickOpenAt } from "./coinbase";

const LOCK_BUFFER_S = 3; // wait past lockTime so block.timestamp >= lockTime
const MAX_ABS_BPS = 300; // clamp extreme outliers to +/-3%

/** Signed, clamped basis-point change from open to close. */
export function toBps(open: number, close: number): number {
  if (!open || !close) return 0;
  const bps = Math.round(((close - open) / open) * 10000);
  return Math.max(-MAX_ABS_BPS, Math.min(MAX_ABS_BPS, bps));
}

export type TickResult =
  | { action: "waiting"; roundId: string; secondsLeft: number }
  | { action: "started"; newRound: string }
  | { action: "resolved-and-started"; resolvedRound: string; bps: number; newRound: string }
  | { action: "skip"; reason: string };

async function confirm(hash: Hex, label: string): Promise<void> {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${label} reverted (${hash})`);
}

async function startNextRound(): Promise<string> {
  const hash = await sendStartRound();
  await confirm(hash, "startRound");
  const id = await getCurrentRoundId();
  console.log(`[operator] startRound ok → round ${id} (${hash})`);
  return id.toString();
}

export async function runTick(asset = "BTC"): Promise<TickResult> {
  const id = await getCurrentRoundId();

  if (id !== 0n) {
    const round = await getRound(id);
    if (!round.resolved) {
      const nowSec = Math.floor(Date.now() / 1000);
      const dueAt = round.lockTime + LOCK_BUFFER_S;
      if (nowSec < dueAt) {
        // Still inside the betting window — never start a second round.
        return { action: "waiting", roundId: id.toString(), secondsLeft: dueAt - nowSec };
      }

      // Lock time passed → resolve from Coinbase candles, then start the next.
      const candles = await fetchCoinbaseCandles(asset);
      if (!candles) return { action: "skip", reason: "price feed unavailable" };
      const open = pickOpenAt(candles, round.startTime);
      const close = pickOpenAt(candles, round.lockTime);
      if (open == null || close == null) {
        return { action: "skip", reason: "no candle for round window" };
      }

      const bps = toBps(open, close);
      console.log(
        `[operator] resolving round ${id}: open ${open} → close ${close} = ${bps >= 0 ? "+" : ""}${bps} bps`,
      );
      const hash = await sendResolveRound(bps);
      await confirm(hash, "resolveRound");
      console.log(`[operator] resolveRound ok for round ${id} (${hash})`);

      const newRound = await startNextRound();
      return { action: "resolved-and-started", resolvedRound: id.toString(), bps, newRound };
    }
  }

  // No round yet, or the latest round is already resolved → open a new one.
  const newRound = await startNextRound();
  return { action: "started", newRound };
}
