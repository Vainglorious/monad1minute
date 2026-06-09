import { describe, it, expect } from "vitest";
import { validateUsername } from "./username";

describe("validateUsername", () => {
  it("accepts a valid handle and trims whitespace", () => {
    expect(validateUsername("  satoshi_99 ")).toEqual({ ok: true, value: "satoshi_99" });
  });

  it("rejects non-strings", () => {
    expect(validateUsername(undefined).ok).toBe(false);
    expect(validateUsername(42).ok).toBe(false);
  });

  it("rejects too short", () => {
    expect(validateUsername("ab").ok).toBe(false);
  });

  it("rejects too long", () => {
    expect(validateUsername("a".repeat(21)).ok).toBe(false);
  });

  it("rejects invalid characters", () => {
    expect(validateUsername("hey there").ok).toBe(false);
    expect(validateUsername("bad-dash").ok).toBe(false);
    expect(validateUsername("emoji🚀here").ok).toBe(false);
  });

  it("accepts boundary lengths", () => {
    expect(validateUsername("abc").ok).toBe(true);
    expect(validateUsername("a".repeat(20)).ok).toBe(true);
  });
});
