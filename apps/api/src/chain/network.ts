/**
 * Chain config for vault deposit detection (Base / Base Sepolia USDC).
 */
export type AbiChain = "base" | "base-sepolia";

export type ChainConfig = {
  id: AbiChain;
  chainId: number;
  name: string;
  usdc: `0x${string}`;
  explorerTx: (hash: string) => string;
  explorerAddress: (addr: string) => string;
  defaultRpc: string;
};

const CHAINS: Record<AbiChain, ChainConfig> = {
  "base-sepolia": {
    id: "base-sepolia",
    chainId: 84532,
    name: "Base Sepolia",
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    explorerTx: (h) => `https://sepolia.basescan.org/tx/${h}`,
    explorerAddress: (a) => `https://sepolia.basescan.org/address/${a}`,
    defaultRpc: "https://sepolia.base.org",
  },
  base: {
    id: "base",
    chainId: 8453,
    name: "Base",
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    explorerTx: (h) => `https://basescan.org/tx/${h}`,
    explorerAddress: (a) => `https://basescan.org/address/${a}`,
    defaultRpc: "https://mainnet.base.org",
  },
};

export function activeChain(): ChainConfig {
  const id = process.env.CHAIN === "base" ? "base" : "base-sepolia";
  return CHAINS[id];
}

export function rpcUrl(cfg: ChainConfig = activeChain()): string {
  const fromEnv = process.env.CHAIN_RPC_URL?.trim() || process.env.BASE_RPC_URL?.trim();
  return fromEnv || cfg.defaultRpc;
}
