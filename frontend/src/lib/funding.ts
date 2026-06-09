import { createWalletClient, http, parseEther, type Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { monadChain, publicClient, RPC_URL } from "./monad";

/** Amount of MON to send to each new wallet at signup. Configurable via env. */
export function signupFundingAmount(): string {
  return process.env.SIGNUP_FUNDING_MON ?? "0.1";
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
 * Send the signup funding amount of native MON from the deployer to `to`,
 * waiting for the transaction to confirm. Throws if the transfer cannot be
 * sent or reverts — the caller treats that as a failed signup.
 */
export async function fundNewWallet(to: string): Promise<{ hash: Hex; amount: string }> {
  const acct = deployerAccount();
  const amount = signupFundingAmount();

  const client = createWalletClient({
    account: acct,
    chain: monadChain,
    transport: http(RPC_URL),
  });

  const hash = await client.sendTransaction({
    account: acct,
    chain: monadChain,
    to: to as `0x${string}`,
    value: parseEther(amount),
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`Funding transfer reverted (tx ${hash})`);
  }
  return { hash, amount };
}
