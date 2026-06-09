import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { getMonBalance } from "@/lib/monad";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const session = await verifySession(token);
  if (!session) {
    return NextResponse.json({ error: "Session expired." }, { status: 401 });
  }

  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user) {
    return NextResponse.json({ error: "User not found." }, { status: 401 });
  }

  // Balance is best-effort — never block the dashboard on an RPC hiccup.
  let balance: string | null = null;
  try {
    balance = await getMonBalance(user.address);
  } catch (err) {
    console.error("Balance read failed:", err);
  }

  return NextResponse.json({
    user: { username: user.username, address: user.address, balance },
  });
}
