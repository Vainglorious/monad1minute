import { NextRequest, NextResponse } from "next/server";
import { type Address } from "viem";
import { getSessionUser } from "@/lib/auth";
import { publicClient } from "@/lib/monad";
import { scrubError } from "@/lib/funding";
import { prisma } from "@/lib/db";
import { getRound, getUserBet, sendClaim } from "@/lib/contract";

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
  const roundIdRaw = (body as { roundId?: unknown })?.roundId;
  if (typeof roundIdRaw !== "string" || !/^\d+$/.test(roundIdRaw)) {
    return NextResponse.json({ error: "Invalid round id." }, { status: 400 });
  }
  const roundId = BigInt(roundIdRaw);

  // Guard against contract reverts before spending gas.
  let payout: bigint;
  try {
    const [round, myBet] = await Promise.all([
      getRound(roundId),
      getUserBet(roundId, user.address as Address),
    ]);
    if (!round.resolved) {
      return NextResponse.json({ error: "Round not resolved yet." }, { status: 409 });
    }
    if (!myBet.placed || myBet.bucket !== round.winner) {
      return NextResponse.json({ error: "No winnings to claim." }, { status: 409 });
    }
    if (myBet.claimed) {
      return NextResponse.json({ error: "Already claimed." }, { status: 409 });
    }
    payout = round.payoutPerWinner;
  } catch (err) {
    console.error("Claim pre-check failed:", scrubError(err));
    return NextResponse.json({ error: "Could not claim right now." }, { status: 502 });
  }

  let txHash: string;
  try {
    txHash = await sendClaim(
      { privyWalletId: user.privyWalletId, address: user.address },
      roundId,
    );
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
    if (receipt.status !== "success") {
      return NextResponse.json({ error: "Claim transaction failed." }, { status: 502 });
    }
  } catch (err) {
    console.error("claim failed:", scrubError(err));
    return NextResponse.json({ error: "Claim failed. Please try again." }, { status: 502 });
  }

  await prisma.bet
    .updateMany({
      where: { userId: user.id, roundId: roundId.toString() },
      data: { claimed: true, claimTx: txHash },
    })
    .catch((err) => console.error("Claim record failed:", scrubError(err)));

  return NextResponse.json({ txHash, roundId: roundId.toString(), payout: payout.toString() });
}
