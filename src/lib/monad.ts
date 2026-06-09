import { createPublicClient, http, defineChain, formatEther } from "viem";

const RPC_URL = process.env.MONAD_RPC_URL ?? "https://testnet-rpc.monad.xyz";
const CHAIN_ID = Number(process.env.MONAD_CHAIN_ID ?? "10143");

export const monadTestnet = defineChain({
  id: CHAIN_ID,
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: {
    default: { name: "Monad Explorer", url: "https://testnet.monadexplorer.com" },
  },
  testnet: true,
});

const publicClient = createPublicClient({
  chain: monadTestnet,
  transport: http(RPC_URL),
});

/** Read native MON balance for an address. Returns a decimal string (e.g. "0.0"). */
export async function getMonBalance(address: string): Promise<string> {
  const wei = await publicClient.getBalance({ address: address as `0x${string}` });
  return formatEther(wei);
}
