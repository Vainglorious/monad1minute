import { describe, it, expect } from "vitest";
import { pickOpenAt } from "./coinbase";

// rows: [ time(sec), low, high, open, close, volume ], most-recent first
const candles: [number, number, number, number, number, number][] = [
  [1_000_120, 60, 70, 65, 66, 1], // covers [1_000_120, 1_000_180)
  [1_000_060, 60, 70, 63, 65, 1], // covers [1_000_060, 1_000_120)
  [1_000_000, 60, 70, 61, 63, 1], // covers [1_000_000, 1_000_060)
];

describe("pickOpenAt", () => {
  it("returns the open of the bucket containing the timestamp", () => {
    expect(pickOpenAt(candles, 1_000_000)).toBe(61); // start of oldest bucket
    expect(pickOpenAt(candles, 1_000_059)).toBe(61); // last second of oldest bucket
    expect(pickOpenAt(candles, 1_000_060)).toBe(63); // start of middle bucket
    expect(pickOpenAt(candles, 1_000_125)).toBe(65); // inside newest bucket
  });

  it("falls back to the most recent prior candle when no exact bucket", () => {
    // 1_000_300 is past every bucket → use newest (1_000_120)
    expect(pickOpenAt(candles, 1_000_300)).toBe(65);
  });

  it("returns null when there is no candle at or before the timestamp", () => {
    expect(pickOpenAt(candles, 999_000)).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(pickOpenAt([], 1_000_000)).toBeNull();
  });
});
