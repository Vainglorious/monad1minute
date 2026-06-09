import { coinbaseOpenAt } from "./coinbase";
import {
  getConfig,
  getCurrentRoundId,
  getRound,
  getBucketCounts,
} from "./contract";

// Shared, JSON-safe snapshot of the round state served to every concurrent
// /api/round request. One fetch per TTL window regardless of user count, so
// 50+ polling clients cost ~1 RPC batch per second instead of ~6 calls each.

export interface SharedRound {
  roundId: string;
  startTime: number;
  lockTime: number;
  resolved: boolean;
  winner: number;
  betCount: number;
  winnerCount: number;
  payoutPerWinner: string;
}

export interface SharedConfig {
  betAmount: string;
  bucketMultipliers: string[];
  multiplierScale: string;
  bettingDuration: number;
}

export interface SharedState {
  config: SharedConfig;
  round: SharedRound | null;
  bucketCounts: number[];
  basePrice: number | null;
}

const STATE_TTL_MS = 1_000;
const CONFIG_TTL_MS = 60_000;

let configCache: { value: SharedConfig; at: number } | null = null;
let stateCache: { value: SharedState; at: number } | null = null;
let inflight: Promise<SharedState> | null = null;
// basePrice is the Coinbase candle open at startTime — constant for a round.
let basePriceCache: { startTime: number; value: number | null } | null = null;

async function fetchConfig(): Promise<SharedConfig> {
  if (configCache && Date.now() - configCache.at < CONFIG_TTL_MS) {
    return configCache.value;
  }
  const c = await getConfig();
  const value: SharedConfig = {
    betAmount: c.betAmount.toString(),
    bucketMultipliers: c.bucketMultipliers.map((m) => m.toString()),
    multiplierScale: c.multiplierScale.toString(),
    bettingDuration: c.bettingDuration,
  };
  configCache = { value, at: Date.now() };
  return value;
}

async function fetchBasePrice(startTime: number): Promise<number | null> {
  if (basePriceCache?.startTime === startTime && basePriceCache.value !== null) {
    return basePriceCache.value;
  }
  // Canonical round-open = Coinbase candle open at startTime (matches settlement).
  const value = await coinbaseOpenAt(startTime).catch(() => null);
  basePriceCache = { startTime, value };
  return value;
}

async function fetchState(): Promise<SharedState> {
  const [config, roundId] = await Promise.all([fetchConfig(), getCurrentRoundId()]);

  if (roundId === 0n) {
    return { config, round: null, bucketCounts: [], basePrice: null };
  }

  const [round, bucketCounts] = await Promise.all([
    getRound(roundId),
    getBucketCounts(roundId),
  ]);
  const basePrice = await fetchBasePrice(round.startTime);

  return {
    config,
    round: {
      roundId: round.roundId.toString(),
      startTime: round.startTime,
      lockTime: round.lockTime,
      resolved: round.resolved,
      winner: round.winner,
      betCount: round.betCount,
      winnerCount: round.winnerCount,
      payoutPerWinner: round.payoutPerWinner.toString(),
    },
    bucketCounts,
    basePrice,
  };
}

export async function getSharedState(): Promise<SharedState> {
  if (stateCache && Date.now() - stateCache.at < STATE_TTL_MS) {
    return stateCache.value;
  }
  if (inflight) return inflight;
  inflight = fetchState()
    .then((value) => {
      stateCache = { value, at: Date.now() };
      return value;
    })
    .catch((err) => {
      // Under load, a transient RPC hiccup shouldn't 502 every client at
      // once — serve the last good snapshot if we have one.
      if (stateCache) return stateCache.value;
      throw err;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
