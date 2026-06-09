import { describe, it, expect, beforeAll } from "vitest";
import { signSession, verifySession } from "./session";

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-123";
});

describe("session sign/verify", () => {
  it("round-trips a valid payload", async () => {
    const token = await signSession({ userId: "u_123", username: "satoshi" });
    const payload = await verifySession(token);
    expect(payload).toEqual({ userId: "u_123", username: "satoshi" });
  });

  it("rejects a tampered token", async () => {
    const token = await signSession({ userId: "u_123", username: "satoshi" });
    const tampered = token.slice(0, -3) + "aaa";
    expect(await verifySession(tampered)).toBeNull();
  });

  it("rejects garbage", async () => {
    expect(await verifySession("not.a.jwt")).toBeNull();
  });

  it("rejects an expired token", async () => {
    const token = await signSession({ userId: "u_123", username: "satoshi" }, "0s");
    // small delay so exp is in the past
    await new Promise((r) => setTimeout(r, 1100));
    expect(await verifySession(token)).toBeNull();
  });
});
