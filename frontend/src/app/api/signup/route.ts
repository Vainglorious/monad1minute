import { NextRequest, NextResponse } from "next/server";
import { validateUsername } from "@/lib/username";
import { createServerWallet } from "@/lib/privy";
import { prisma } from "@/lib/db";
import { signSession, SESSION_COOKIE } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const result = validateUsername((body as { username?: unknown })?.username);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  const username = result.value;

  // Reject duplicates up front (also guarded by the unique constraint below).
  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    return NextResponse.json({ error: "That handle is taken." }, { status: 409 });
  }

  // Create the wallet first; only persist if it succeeds.
  let wallet;
  try {
    wallet = await createServerWallet();
  } catch (err) {
    console.error("Privy wallet creation failed:", err);
    return NextResponse.json(
      { error: "Could not create your wallet. Please try again." },
      { status: 502 },
    );
  }

  let user;
  try {
    user = await prisma.user.create({
      data: {
        username,
        privyWalletId: wallet.walletId,
        address: wallet.address,
      },
    });
  } catch (err: unknown) {
    // Unique violation (race on username) → 409.
    if (typeof err === "object" && err && (err as { code?: string }).code === "P2002") {
      return NextResponse.json({ error: "That handle is taken." }, { status: 409 });
    }
    console.error("Persist user failed:", err);
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }

  const token = await signSession({ userId: user.id, username: user.username });
  const res = NextResponse.json({
    user: { username: user.username, address: user.address },
  });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
