import { NextRequest, NextResponse } from "next/server";
import { type Address } from "viem";
import { getSessionUser } from "@/lib/auth";
import { getMonBalance } from "@/lib/monad";
import { scrubError } from "@/lib/funding";
import {
  getCurrentRoundId,
  getRound,
  getConfig,
  getUserBet,
  getBucketCounts,
} from "@/lib/contract";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  try {
    const [config, roundId] = await Promise.all([getConfig(), getCurrentRoundId()]);
    const now = Math.floor(Date.now() / 1000);

    if (roundId === 0n) {
      const balance = await getMonBalance(user.address).catch(() => null);
      return NextResponse.json({
        now,
        config: serializeConfig(config),
        round: null,
        bucketCounts: [],
        myBet: null,
        balance,
      });
    }

    const [round, bucketCounts, myBet, balance] = await Promise.all([
      getRound(roundId),
      getBucketCounts(roundId),
      getUserBet(roundId, user.address as Address),
      getMonBalance(user.address).catch(() => null),
    ]);

    return NextResponse.json({
      now,
      config: serializeConfig(config),
      round: {
        roundId: round.roundId.toString(),
        startTime: round.startTime,
        lockTime: round.lockTime,
        resolved: round.resolved,
        winner: round.winner,
        betCount: round.betCount,
        winnerCount: round.winnerCount,
        payoutPerWinner: round.payoutPerWinner.toString(),
      },
      bucketCounts,
      myBet: myBet.placed ? myBet : null,
      balance,
    });
  } catch (err) {
    console.error("Round read failed:", scrubError(err));
    return NextResponse.json({ error: "Could not read the current round." }, { status: 502 });
  }
}

function serializeConfig(c: {
  betAmount: bigint;
  extremeMultiplier: bigint;
  middleMultiplier: bigint;
  bettingDuration: number;
}) {
  return {
    betAmount: c.betAmount.toString(),
    extremeMultiplier: c.extremeMultiplier.toString(),
    middleMultiplier: c.middleMultiplier.toString(),
    bettingDuration: c.bettingDuration,
  };
}
