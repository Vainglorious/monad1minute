import {
  createWalletClient,
  http,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
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
  // One eth_call via Multicall3 instead of four parallel reads.
  const [betAmount, bucketMultipliers, multiplierScale, bettingDuration] =
    (await publicClient.multicall({
      allowFailure: false,
      contracts: [
        { address: CONTRACT_ADDRESS, abi, functionName: "betAmount" },
        { address: CONTRACT_ADDRESS, abi, functionName: "getBucketMultipliers" },
        { address: CONTRACT_ADDRESS, abi, functionName: "MULTIPLIER_SCALE" },
        { address: CONTRACT_ADDRESS, abi, functionName: "bettingDuration" },
      ],
    })) as [bigint, readonly bigint[], bigint, bigint];
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
  // One eth_call via Multicall3 instead of six parallel reads.
  const counts = (await publicClient.multicall({
    allowFailure: false,
    contracts: Array.from({ length: BUCKET_COUNT }, (_, i) => ({
      address: CONTRACT_ADDRESS,
      abi,
      functionName: "bucketCount",
      args: [roundId, i],
    })),
  })) as bigint[];
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

// --- operator writes (signed by OPERATOR_PRIVATE_KEY; must equal the contract's
//     `operator` address) ---

function normalizeKey(raw: string): Hex {
  const k = raw.trim();
  return (k.startsWith("0x") ? k : `0x${k}`) as Hex;
}

let operatorAcct: PrivateKeyAccount | null = null;

function operatorAccount(): PrivateKeyAccount {
  if (operatorAcct) return operatorAcct;
  const pk = process.env.OPERATOR_PRIVATE_KEY;
  if (!pk) throw new Error("OPERATOR_PRIVATE_KEY is not set");
  operatorAcct = privateKeyToAccount(normalizeKey(pk));
  return operatorAcct;
}

function operatorWallet() {
  return createWalletClient({
    account: operatorAccount(),
    chain: monadChain,
    transport: http(RPC_URL),
  });
}

/** Operator: open a new round. Reverts "round active" if one is still unresolved. */
export async function sendStartRound(): Promise<Hex> {
  const wallet = operatorWallet();
  return wallet.writeContract({
    account: wallet.account,
    chain: monadChain,
    address: CONTRACT_ADDRESS,
    abi,
    functionName: "startRound",
  });
}

/** Operator: resolve the active round with a signed basis-point price change. */
export async function sendResolveRound(priceChangeBps: number): Promise<Hex> {
  const wallet = operatorWallet();
  return wallet.writeContract({
    account: wallet.account,
    chain: monadChain,
    address: CONTRACT_ADDRESS,
    abi,
    functionName: "resolveRound",
    args: [BigInt(priceChangeBps)],
  });
}
