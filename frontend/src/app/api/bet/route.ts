import { NextRequest, NextResponse } from "next/server";
import { parseEther, type Address } from "viem";
import { getSessionUser } from "@/lib/auth";
import { getMonBalance, publicClient } from "@/lib/monad";
import { isValidBucket } from "@/lib/buckets";
import { scrubError } from "@/lib/funding";
import { prisma } from "@/lib/db";
import {
  getCurrentRoundId,
  getRound,
  getConfig,
  getUserBet,
  sendPlaceBet,
} from "@/lib/contract";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const bucket = (body as { bucket?: unknown })?.bucket;
  if (!isValidBucket(bucket)) {
    return NextResponse.json({ error: "Pick a bucket from 0 to 5." }, { status: 400 });
  }

  // Read state and guard before spending.
  let roundId: bigint;
  let stake: bigint;
  try {
    const [id, config] = await Promise.all([getCurrentRoundId(), getConfig()]);
    roundId = id;
    stake = config.betAmount;
    if (roundId === 0n) {
      return NextResponse.json({ error: "No active round." }, { status: 409 });
    }
    const now = Math.floor(Date.now() / 1000);
    const [round, myBet] = await Promise.all([
      getRound(roundId),
      getUserBet(roundId, user.address as Address),
    ]);
    if (round.resolved || now >= round.lockTime) {
      return NextResponse.json({ error: "Betting is closed for this round." }, { status: 409 });
    }
    if (myBet.placed) {
      return NextResponse.json({ error: "You already bet this round." }, { status: 409 });
    }
    const balanceWei = await publicClient.getBalance({ address: user.address as Address });
    // Need the stake plus a little for gas.
    if (balanceWei < stake + parseEther("0.01")) {
      return NextResponse.json(
        { error: "Not enough MON to place this bet." },
        { status: 402 },
      );
    }
  } catch (err) {
    console.error("Bet pre-check failed:", scrubError(err));
    return NextResponse.json({ error: "Could not place your bet right now." }, { status: 502 });
  }

  // Sign and broadcast the bet from the user's custodial wallet.
  let txHash: string;
  try {
    txHash = await sendPlaceBet(
      { privyWalletId: user.privyWalletId, address: user.address },
      bucket,
      stake,
    );
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
    if (receipt.status !== "success") {
      return NextResponse.json({ error: "Bet transaction failed." }, { status: 502 });
    }
  } catch (err) {
    console.error("placeBet failed:", scrubError(err));
    return NextResponse.json(
      { error: "Bet failed — the round may have just closed." },
      { status: 502 },
    );
  }

  // Record it (best-effort; the on-chain bet is the source of truth).
  await prisma.bet
    .create({
      data: {
        userId: user.id,
        roundId: roundId.toString(),
        bucket,
        amount: stake.toString(),
        txHash,
      },
    })
    .catch((err) => console.error("Bet record failed:", scrubError(err)));

  return NextResponse.json({ txHash, roundId: roundId.toString(), bucket });
}
