/** Supported networks are explicit: equal EVM addresses do not imply equal balances. */
import { createPublicClient, http, formatUnits, type Address, type Hex } from "viem";
import { base, mainnet, baseSepolia } from "viem/chains";
export const WALLET_ASSETS = [
  {
    id: "base:usdc",
    symbol: "USDC",
    network: "Base",
    chainId: 8453,
    decimals: 6,
    contract: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    testnet: false,
  },
  {
    id: "base:eth",
    symbol: "ETH",
    network: "Base",
    chainId: 8453,
    decimals: 18,
    contract: null,
    testnet: false,
  },
  {
    id: "ethereum:usdc",
    symbol: "USDC",
    network: "Ethereum",
    chainId: 1,
    decimals: 6,
    contract: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    testnet: false,
  },
  {
    id: "ethereum:eth",
    symbol: "ETH",
    network: "Ethereum",
    chainId: 1,
    decimals: 18,
    contract: null,
    testnet: false,
  },
  {
    id: "base-sepolia:usdc",
    symbol: "USDC",
    network: "Base Sepolia",
    chainId: 84532,
    decimals: 6,
    contract: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    testnet: true,
  },
  {
    id: "base-sepolia:eth",
    symbol: "ETH",
    network: "Base Sepolia",
    chainId: 84532,
    decimals: 18,
    contract: null,
    testnet: true,
  },
] as const;
export type WalletAsset = (typeof WALLET_ASSETS)[number];
export function walletAsset(id: string): WalletAsset {
  const asset = WALLET_ASSETS.find((a) => a.id === id);
  if (!asset) throw new Error("Choose a supported currency and network.");
  return asset;
}
export interface WalletChainClient {
  getChainId(): Promise<number>;
  getBlockNumber(): Promise<bigint>;
  getBalance(args: { address: Address; blockNumber?: bigint }): Promise<bigint>;
  readContract(args: {
    address: Address;
    abi: typeof balanceAbi;
    functionName: "balanceOf";
    args: readonly [Address];
    blockNumber?: bigint;
  }): Promise<bigint>;
  estimateFeesPerGas(): Promise<{ maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint }>;
  estimateGas(args: { account: Address; to: Address; value: bigint; data?: Hex }): Promise<bigint>;
  getTransactionReceipt(args: {
    hash: Hex;
  }): Promise<{ blockNumber: bigint; status: "success" | "reverted" }>;
}
export function assetClient(asset: WalletAsset): WalletChainClient {
  const chain = asset.chainId === 1 ? mainnet : asset.chainId === 8453 ? base : baseSepolia;
  const rpc =
    asset.chainId === 1
      ? process.env.ETHEREUM_RPC_URL || "https://ethereum-rpc.publicnode.com"
      : asset.chainId === 8453
        ? process.env.BASE_MAINNET_RPC_URL || "https://mainnet.base.org"
        : process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
  return createPublicClient({ chain, transport: http(rpc, { timeout: 6000, retryCount: 0 }) });
}
export const balanceAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;
export async function readAssetBalance(
  address: Address,
  asset: WalletAsset,
  client = assetClient(asset),
) {
  if ((await client.getChainId()) !== asset.chainId)
    throw new Error("Wallet network verification failed.");
  const block = await client.getBlockNumber();
  const [units, gas] = await Promise.all([
    asset.contract
      ? client.readContract({
          address: asset.contract,
          abi: balanceAbi,
          functionName: "balanceOf",
          args: [address],
          blockNumber: block,
        })
      : client.getBalance({ address, blockNumber: block }),
    client.getBalance({ address, blockNumber: block }),
  ]);
  return {
    amount: formatUnits(units, asset.decimals),
    units: units.toString(),
    gasEth: formatUnits(gas, 18),
    block: block.toString(),
    observedAt: new Date().toISOString(),
    status: "available" as const,
  };
}
export function walletExplorer(asset: WalletAsset) {
  return asset.chainId === 1
    ? "https://etherscan.io"
    : asset.chainId === 8453
      ? "https://basescan.org"
      : "https://sepolia.basescan.org";
}
