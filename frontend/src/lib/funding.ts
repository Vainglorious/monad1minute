import { createWalletClient, http, parseEther, type Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { monadChain, publicClient, RPC_URL } from "./monad";

/** Amount of MON to send to each new wallet at signup. Configurable via env. */
export function signupFundingAmount(): string {
  return process.env.SIGNUP_FUNDING_MON ?? "0.1";
}

/**
 * Error thrown when funding does not complete. `broadcast` distinguishes the two
 * cases the caller must handle differently:
 *  - broadcast=false: the transfer never left the deployer (pre-broadcast failure)
 *    → safe to roll back the signup.
 *  - broadcast=true: the transfer WAS broadcast (funds may already have moved)
 *    → must NOT roll back; the account is funded / funds are in flight.
 */
export class FundingError extends Error {
  readonly broadcast: boolean;
  readonly hash?: Hex;
  constructor(message: string, opts: { broadcast: boolean; hash?: Hex }) {
    super(message);
    this.name = "FundingError";
    this.broadcast = opts.broadcast;
    this.hash = opts.hash;
  }
}

/** Redact the RPC URL/host from any string so embedded credentials never leak to logs. */
export function scrubError(input: unknown): string {
  let s = input instanceof Error ? `${input.name}: ${input.message ?? ""}` : String(input);
  if (RPC_URL) {
    s = s.split(RPC_URL).join("<rpc>");
    try {
      s = s.split(new URL(RPC_URL).host).join("<rpc-host>");
    } catch {
      /* RPC_URL not a parseable URL — the split above still ran */
    }
  }
  return s.slice(0, 300);
}

function normalizeKey(raw: string): Hex {
  const k = raw.trim();
  return (k.startsWith("0x") ? k : `0x${k}`) as Hex;
}

let account: PrivateKeyAccount | null = null;

function deployerAccount(): PrivateKeyAccount {
  if (account) return account;
  const pk = process.env.DEPLOYER_PRIVATE_KEY;
  if (!pk) throw new Error("DEPLOYER_PRIVATE_KEY is not set");
  const acct = privateKeyToAccount(normalizeKey(pk));

  // Optional safety: if DEPLOYER_ADDRESS is provided, it must match the key.
  const declared = process.env.DEPLOYER_ADDRESS;
  if (declared && declared.toLowerCase() !== acct.address.toLowerCase()) {
    throw new Error("DEPLOYER_ADDRESS does not match DEPLOYER_PRIVATE_KEY");
  }

  account = acct;
  return account;
}

/**
 * Send the signup funding amount of native MON from the deployer to `to`.
 * Throws a {@link FundingError}; inspect `.broadcast` to decide whether a
 * rollback is safe.
 */
export async function fundNewWallet(to: string): Promise<{ hash: Hex; amount: string }> {
  const acct = deployerAccount();
  const amount = signupFundingAmount();
  const client = createWalletClient({
    account: acct,
    chain: monadChain,
    transport: http(RPC_URL),
  });

  // Phase 1: broadcast. A failure here means nothing left the deployer.
  let hash: Hex;
  try {
    hash = await client.sendTransaction({
      account: acct,
      chain: monadChain,
      to: to as `0x${string}`,
      value: parseEther(amount),
    });
  } catch (err) {
    throw new FundingError(`send failed: ${scrubError(err)}`, { broadcast: false });
  }

  // Phase 2: confirm. The tx is already broadcast — never roll back from here.
  try {
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new FundingError("transfer reverted", { broadcast: true, hash });
    }
  } catch (err) {
    if (err instanceof FundingError) throw err;
    throw new FundingError(`confirmation unverified: ${scrubError(err)}`, {
      broadcast: true,
      hash,
    });
  }

  return { hash, amount };
}
