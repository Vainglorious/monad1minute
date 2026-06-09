import { PrivyClient } from "@privy-io/server-auth";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

// Privy's SDK defaults to a tight 10s timeout; raise it (configurable) so a
// transient slow request doesn't fail signup. Wallet creation is normally <1s.
const PRIVY_TIMEOUT_MS = Number(process.env.PRIVY_TIMEOUT_MS ?? "25000");
const CREATE_RETRIES = 2; // total attempts = 1 + CREATE_RETRIES

let client: PrivyClient | null = null;

function getClient(): PrivyClient {
  if (client) return client;
  // The authorization key is optional for wallet creation/reads; it becomes
  // required later when the backend signs transactions (betting milestone).
  const authorizationPrivateKey = process.env.PRIVY_AUTHORIZATION_KEY;
  client = new PrivyClient(requireEnv("PRIVY_APP_ID"), requireEnv("PRIVY_APP_SECRET"), {
    timeout: PRIVY_TIMEOUT_MS,
    ...(authorizationPrivateKey ? { walletApi: { authorizationPrivateKey } } : {}),
  });
  return client;
}

export interface CreatedWallet {
  walletId: string;
  address: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Create a custodial EVM wallet. The resulting address is usable on any EVM
 * chain, including Monad. Retries a couple of times on transient failures
 * (e.g. timeouts) before giving up.
 */
export async function createServerWallet(): Promise<CreatedWallet> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= CREATE_RETRIES; attempt++) {
    try {
      const wallet = await getClient().walletApi.createWallet({ chainType: "ethereum" });
      return { walletId: wallet.id, address: wallet.address };
    } catch (err) {
      lastErr = err;
      if (attempt < CREATE_RETRIES) {
        await sleep(400 * (attempt + 1)); // 400ms, then 800ms
      }
    }
  }
  throw lastErr;
}
