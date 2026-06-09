import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { scrubError } from "@/lib/funding";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

interface Row {
  username: string;
  bets: number;
  wins: number;
  wagered: string; // total stake in wei, as decimal string
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  try {
    // amount is stored as a wei decimal string, so the sum happens in
    // Postgres numeric space rather than JS floats.
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT
        u."username"                                  AS "username",
        COUNT(b."id")::int                            AS "bets",
        (COUNT(*) FILTER (WHERE b."claimed"))::int    AS "wins",
        COALESCE(SUM(b."amount"::numeric), 0)::text   AS "wagered"
      FROM "Bet" b
      JOIN "User" u ON u."id" = b."userId"
      GROUP BY u."id", u."username"
      ORDER BY "wins" DESC, SUM(b."amount"::numeric) DESC, "bets" DESC
      LIMIT 10
    `;
    return NextResponse.json({ leaders: rows, me: user.username });
  } catch (err) {
    console.error("Leaderboard query failed:", scrubError(err));
    return NextResponse.json({ error: "Could not load leaderboard." }, { status: 502 });
  }
}
