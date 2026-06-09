import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the chain + price dependencies; keep the real pure pickOpenAt.
vi.mock("./contract", () => ({
  getCurrentRoundId: vi.fn(),
  getRound: vi.fn(),
  sendStartRound: vi.fn(async () => "0xstart" as const),
  sendResolveRound: vi.fn(async () => "0xresolve" as const),
}));
vi.mock("./monad", () => ({
  publicClient: { waitForTransactionReceipt: vi.fn(async () => ({ status: "success" })) },
}));
vi.mock("./coinbase", async (importActual) => {
  const actual = await importActual<typeof import("./coinbase")>();
  return { ...actual, fetchCoinbaseCandles: vi.fn() };
});

import { runTick, toBps } from "./operator";
import {
  getCurrentRoundId,
  getRound,
  sendStartRound,
  sendResolveRound,
} from "./contract";
import { fetchCoinbaseCandles } from "./coinbase";

const round = (over: Partial<ReturnType<typeof baseRound>> = {}) => ({ ...baseRound(), ...over });
function baseRound() {
  return {
    roundId: 5n,
    startTime: 1_000_000,
    lockTime: 1_000_060,
    resolved: false,
    winner: 0,
    betCount: 0,
    winnerCount: 0,
    payoutPerWinner: 0n,
  };
}

// candles covering [1_000_000,1_000_060)=open 100 and [1_000_060,1_000_120)=open 101
const candles: [number, number, number, number, number, number][] = [
  [1_000_060, 99, 102, 101, 100, 1],
  [1_000_000, 98, 101, 100, 101, 1],
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("toBps", () => {
  it("computes signed basis points", () => {
    expect(toBps(100, 101)).toBe(100); // +1%
    expect(toBps(100, 99)).toBe(-100); // -1%
    expect(toBps(100, 100)).toBe(0);
  });
  it("clamps to +/-300 bps", () => {
    expect(toBps(100, 200)).toBe(300);
    expect(toBps(100, 50)).toBe(-300);
  });
  it("returns 0 on missing prices", () => {
    expect(toBps(0, 100)).toBe(0);
  });
});

describe("runTick", () => {
  it("starts the first round when none exists", async () => {
    vi.mocked(getCurrentRoundId).mockResolvedValueOnce(0n).mockResolvedValueOnce(1n);
    const res = await runTick();
    expect(res).toEqual({ action: "started", newRound: "1" });
    expect(sendStartRound).toHaveBeenCalledOnce();
    expect(sendResolveRound).not.toHaveBeenCalled();
  });

  it("waits while the round is still inside its betting window", async () => {
    vi.setSystemTime(1_000_030_000); // 1_000_030s < lockTime+3
    vi.mocked(getCurrentRoundId).mockResolvedValueOnce(5n);
    vi.mocked(getRound).mockResolvedValueOnce(round());
    const res = await runTick();
    expect(res).toEqual({ action: "waiting", roundId: "5", secondsLeft: 33 });
    expect(sendStartRound).not.toHaveBeenCalled();
    expect(sendResolveRound).not.toHaveBeenCalled();
  });

  it("resolves a due round from candles, then starts the next", async () => {
    vi.setSystemTime(1_000_070_000); // past lockTime+3
    vi.mocked(getCurrentRoundId).mockResolvedValueOnce(5n).mockResolvedValueOnce(6n);
    vi.mocked(getRound).mockResolvedValueOnce(round());
    vi.mocked(fetchCoinbaseCandles).mockResolvedValueOnce(candles);
    const res = await runTick();
    expect(res).toEqual({
      action: "resolved-and-started",
      resolvedRound: "5",
      bps: 100,
      newRound: "6",
    });
    expect(sendResolveRound).toHaveBeenCalledWith(100);
    expect(sendStartRound).toHaveBeenCalledOnce();
  });

  it("skips (no settle) when the price feed is unavailable", async () => {
    vi.setSystemTime(1_000_070_000);
    vi.mocked(getCurrentRoundId).mockResolvedValueOnce(5n);
    vi.mocked(getRound).mockResolvedValueOnce(round());
    vi.mocked(fetchCoinbaseCandles).mockResolvedValueOnce(null);
    const res = await runTick();
    expect(res).toEqual({ action: "skip", reason: "price feed unavailable" });
    expect(sendResolveRound).not.toHaveBeenCalled();
    expect(sendStartRound).not.toHaveBeenCalled();
  });

  it("starts a new round when the latest is already resolved", async () => {
    vi.mocked(getCurrentRoundId).mockResolvedValueOnce(5n).mockResolvedValueOnce(6n);
    vi.mocked(getRound).mockResolvedValueOnce(round({ resolved: true }));
    const res = await runTick();
    expect(res).toEqual({ action: "started", newRound: "6" });
    expect(sendStartRound).toHaveBeenCalledOnce();
  });
});
