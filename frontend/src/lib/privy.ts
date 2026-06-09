import { PrivyClient } from "@privy-io/server-auth";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

let client: PrivyClient | null = null;

function getClient(): PrivyClient {
  if (client) return client;
  // The authorization key is optional for wallet creation/reads; it becomes
  // required later when the backend signs transactions (betting milestone).
  const authorizationPrivateKey = process.env.PRIVY_AUTHORIZATION_KEY;
  client = new PrivyClient(
    requireEnv("PRIVY_APP_ID"),
    requireEnv("PRIVY_APP_SECRET"),
    authorizationPrivateKey ? { walletApi: { authorizationPrivateKey } } : undefined,
  );
  return client;
}

export interface CreatedWallet {
  walletId: string;
  address: string;
}

/**
 * Create a custodial EVM wallet owned by our backend authorization key.
 * The resulting address is usable on any EVM chain, including Monad.
 */
export async function createServerWallet(): Promise<CreatedWallet> {
  const wallet = await getClient().walletApi.createWallet({ chainType: "ethereum" });
  return { walletId: wallet.id, address: wallet.address };
}
