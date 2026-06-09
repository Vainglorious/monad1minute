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
  it("extreme uses 5x", () => {
    expect(potentialPayoutWei(0, stake, 5n, 2n)).toBe(stake * 5n);
    expect(potentialPayoutWei(5, stake, 5n, 2n)).toBe(stake * 5n);
  });
  it("middle uses 2x", () => {
    expect(potentialPayoutWei(2, stake, 5n, 2n)).toBe(stake * 2n);
  });
});
