import { SignJWT, jwtVerify } from "jose";

const ISSUER = "monad1minute";
const AUDIENCE = "monad1minute-web";

export interface SessionPayload {
  userId: string;
  username: string;
}

function secret(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is not set");
  return new TextEncoder().encode(s);
}

/** Sign a device-bound session token (default 30d). */
export async function signSession(
  payload: SessionPayload,
  expiresIn = "30d",
): Promise<string> {
  return new SignJWT({ username: payload.username })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secret());
}

/** Verify a session token. Returns the payload or null if invalid/expired. */
export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (typeof payload.sub !== "string" || typeof payload.username !== "string") {
      return null;
    }
    return { userId: payload.sub, username: payload.username };
  } catch {
    return null;
  }
}

export const SESSION_COOKIE = "m1m_session";
