import { createPublicClient, http, defineChain, formatEther } from "viem";

// Network is env-driven so testnet/mainnet is a config switch.
// Defaults target Monad mainnet.
export const RPC_URL =
  process.env.MONAD_RPC ?? process.env.MONAD_RPC_URL ?? "https://rpc.monad.xyz";
const CHAIN_ID = Number(process.env.MONAD_CHAIN_ID ?? "143");

export const monadChain = defineChain({
  id: CHAIN_ID,
  name: CHAIN_ID === 143 ? "Monad" : "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: {
    default: {
      name: "Monad Explorer",
      url:
        CHAIN_ID === 143
          ? "https://monadexplorer.com"
          : "https://testnet.monadexplorer.com",
    },
  },
  testnet: CHAIN_ID !== 143,
});

export const publicClient = createPublicClient({
  chain: monadChain,
  transport: http(RPC_URL),
});

/** Read native MON balance for an address. Returns a decimal string (e.g. "0.0"). */
export async function getMonBalance(address: string): Promise<string> {
  const wei = await publicClient.getBalance({ address: address as `0x${string}` });
  return formatEther(wei);
}
