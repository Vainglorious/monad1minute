import {
  createWalletClient,
  http,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { createViemAccount } from "@privy-io/server-auth/viem";
import abiJson from "./abi/PriceBetGame.json";
import { publicClient, monadChain, RPC_URL } from "./monad";
import { getPrivyClient } from "./privy";

export const abi = abiJson as unknown as Abi;

export const CONTRACT_ADDRESS = (process.env.PRICEBETGAME_ADDRESS ??
  "0x7639cc0fd49e8d574a75c71874c7a37665f751c0") as Address;

export const BUCKET_COUNT = 6;

function read<T>(
  functionName: string,
  args: readonly unknown[] = [],
): Promise<T> {
  return publicClient.readContract({
    address: CONTRACT_ADDRESS,
    abi,
    functionName,
    args,
  }) as Promise<T>;
}

export interface RoundState {
  roundId: bigint;
  startTime: number;
  lockTime: number;
  resolved: boolean;
  winner: number;
  betCount: number;
  winnerCount: number;
  payoutPerWinner: bigint;
}

export interface GameConfig {
  betAmount: bigint;
  /** Per-bucket payout multipliers (length 6), each scaled by multiplierScale. */
  bucketMultipliers: bigint[];
  multiplierScale: bigint;
  bettingDuration: number;
}

export interface UserBet {
  bucket: number;
  placed: boolean;
  claimed: boolean;
}

export async function getCurrentRoundId(): Promise<bigint> {
  return read<bigint>("currentRoundId");
}

export async function getRound(roundId: bigint): Promise<RoundState> {
  const r = await read<
    [bigint, bigint, boolean, number, bigint, bigint, bigint]
  >("rounds", [roundId]);
  return {
    roundId,
    startTime: Number(r[0]),
    lockTime: Number(r[1]),
    resolved: r[2],
    winner: Number(r[3]),
    betCount: Number(r[4]),
    winnerCount: Number(r[5]),
    payoutPerWinner: r[6],
  };
}

export async function getConfig(): Promise<GameConfig> {
  const [betAmount, bucketMultipliers, multiplierScale, bettingDuration] =
    await Promise.all([
      read<bigint>("betAmount"),
      read<readonly bigint[]>("getBucketMultipliers"),
      read<bigint>("MULTIPLIER_SCALE"),
      read<bigint>("bettingDuration"),
    ]);
  return {
    betAmount,
    bucketMultipliers: [...bucketMultipliers],
    multiplierScale,
    bettingDuration: Number(bettingDuration),
  };
}

export async function getUserBet(
  roundId: bigint,
  address: Address,
): Promise<UserBet> {
  const b = await read<[number, boolean, boolean]>("bets", [roundId, address]);
  return { bucket: Number(b[0]), placed: b[1], claimed: b[2] };
}

export async function getBucketCounts(roundId: bigint): Promise<number[]> {
  const counts = await Promise.all(
    Array.from({ length: BUCKET_COUNT }, (_, i) =>
      read<bigint>("bucketCount", [roundId, i]),
    ),
  );
  return counts.map((c) => Number(c));
}

// --- writes (signed by the user's custodial Privy wallet) ---

interface SignableUser {
  privyWalletId: string;
  address: string;
}

async function userWalletClient(user: SignableUser) {
  const account = await createViemAccount({
    walletId: user.privyWalletId,
    address: user.address as Hex,
    // Same class at runtime; the /viem subpath resolves PrivyClient to a
    // different .d.ts, so cast to the exact param type to satisfy tsc.
    privy: getPrivyClient() as unknown as Parameters<
      typeof createViemAccount
    >[0]["privy"],
  });
  return createWalletClient({
    account,
    chain: monadChain,
    transport: http(RPC_URL),
  });
}

export async function sendPlaceBet(
  user: SignableUser,
  bucket: number,
  value: bigint,
): Promise<Hex> {
  const wallet = await userWalletClient(user);
  return wallet.writeContract({
    account: wallet.account,
    chain: monadChain,
    address: CONTRACT_ADDRESS,
    abi,
    functionName: "placeBet",
    args: [bucket],
    value,
  });
}

export async function sendClaim(
  user: SignableUser,
  roundId: bigint,
): Promise<Hex> {
  const wallet = await userWalletClient(user);
  return wallet.writeContract({
    account: wallet.account,
    chain: monadChain,
    address: CONTRACT_ADDRESS,
    abi,
    functionName: "claim",
    args: [roundId],
  });
}
