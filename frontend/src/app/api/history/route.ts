import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { scrubError } from "@/lib/funding";
import { prisma } from "@/lib/db";
import { getRound } from "@/lib/contract";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const bets = await prisma.bet.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  // Read each round's outcome on-chain (source of truth for win/payout).
  const items = await Promise.all(
    bets.map(async (b) => {
      let resolved = false;
      let winner: number | null = null;
      let won: boolean | null = null;
      let payout: string | null = null;
      try {
        const round = await getRound(BigInt(b.roundId));
        resolved = round.resolved;
        if (resolved) {
          winner = round.winner;
          won = b.bucket === round.winner;
          payout = won ? round.payoutPerWinner.toString() : "0";
        }
      } catch (err) {
        console.error(`History round ${b.roundId} read failed:`, scrubError(err));
      }
      return {
        roundId: b.roundId,
        bucket: b.bucket,
        amount: b.amount,
        txHash: b.txHash,
        claimed: b.claimed,
        createdAt: b.createdAt.toISOString(),
        resolved,
        winner,
        won,
        payout,
      };
    }),
  );

  return NextResponse.json({ bets: items });
}
