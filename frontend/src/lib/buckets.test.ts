import { describe, it, expect } from "vitest";
import {
  isExtreme,
  isValidBucket,
  derivePhase,
  potentialPayoutWei,
  BUCKETS,
} from "./buckets";

describe("buckets", () => {
  it("has six buckets, A..F", () => {
    expect(BUCKETS.map((b) => b.key)).toEqual(["A", "B", "C", "D", "E", "F"]);
  });

  it("marks only 0 and 5 as extreme", () => {
    expect([0, 1, 2, 3, 4, 5].map(isExtreme)).toEqual([true, false, false, false, false, true]);
  });

  it("validates bucket ids", () => {
    expect(isValidBucket(0)).toBe(true);
    expect(isValidBucket(5)).toBe(true);
    expect(isValidBucket(6)).toBe(false);
    expect(isValidBucket(-1)).toBe(false);
    expect(isValidBucket(1.5)).toBe(false);
    expect(isValidBucket("2")).toBe(false);
  });
});

describe("derivePhase", () => {
  it("none when no round", () => {
    expect(derivePhase(null, 100)).toBe("none");
  });
  it("open before lock", () => {
    expect(derivePhase({ resolved: false, lockTime: 200 }, 100)).toBe("open");
  });
  it("locked after lock, not resolved", () => {
    expect(derivePhase({ resolved: false, lockTime: 200 }, 250)).toBe("locked");
  });
  it("resolved wins over time", () => {
    expect(derivePhase({ resolved: true, lockTime: 200 }, 100)).toBe("resolved");
  });
});

describe("potentialPayoutWei", () => {
  const stake = 200000000000000000n; // 0.2 MON
  // per-bucket multipliers scaled by 100: A:20x B:10x C:2.8x D:2.8x E:10x F:20x
  const mult = [2000n, 1000n, 280n, 280n, 1000n, 2000n];
  it("extremes (A,F) use 20x", () => {
    expect(potentialPayoutWei(0, stake, mult)).toBe((stake * 2000n) / 100n);
    expect(potentialPayoutWei(5, stake, mult)).toBe((stake * 2000n) / 100n);
  });
  it("mid (B,E) use 10x", () => {
    expect(potentialPayoutWei(1, stake, mult)).toBe((stake * 1000n) / 100n);
    expect(potentialPayoutWei(4, stake, mult)).toBe((stake * 1000n) / 100n);
  });
  it("near-zero (C,D) use 2.8x", () => {
    expect(potentialPayoutWei(2, stake, mult)).toBe((stake * 280n) / 100n);
  });
});
