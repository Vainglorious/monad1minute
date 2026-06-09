import { describe, it, expect } from "vitest";
import {
  isExtreme,
  isValidBucket,
  derivePhase,
  potentialPayoutWei,
  multiplierLabel,
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
  // [2000,1000,280,280,1000,2000] scaled by 100 → 20x/10x/2.8x/...
  const mults = [2000n, 1000n, 280n, 280n, 1000n, 2000n];
  const scale = 100n;
  it("applies the per-bucket multiplier / scale", () => {
    expect(potentialPayoutWei(0, stake, mults, scale)).toBe((stake * 2000n) / 100n);
    expect(potentialPayoutWei(2, stake, mults, scale)).toBe((stake * 280n) / 100n);
  });
  it("returns 0 for a zero scale", () => {
    expect(potentialPayoutWei(0, stake, mults, 0n)).toBe(0n);
  });
});

describe("multiplierLabel", () => {
  it("formats integer and fractional multipliers", () => {
    expect(multiplierLabel(2000n, 100n)).toBe("20×");
    expect(multiplierLabel(280n, 100n)).toBe("2.8×");
    expect(multiplierLabel(1000n, 100n)).toBe("10×");
  });
});
