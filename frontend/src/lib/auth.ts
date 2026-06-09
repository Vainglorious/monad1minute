import { NextRequest } from "next/server";
import { prisma } from "./db";
import { verifySession, SESSION_COOKIE } from "./session";

/** Resolve the authenticated user from the session cookie, or null. */
export async function getSessionUser(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await verifySession(token);
  if (!session) return null;
  return prisma.user.findUnique({ where: { id: session.userId } });
}
