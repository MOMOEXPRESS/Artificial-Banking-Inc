/**
 * Per-asset chain adapters (P7-T3).
 *
 * Before this, exactly one asset was chain-backed: USDC on the active Base
 * network. Everything else in the `assets` table — EURC, USDT, DAI, ETH, BTC,
 * SOL — was a manually recorded number that looked identical to a real holding
 * in the console. A treasury screen that presents typed-in balances the same
 * way it presents verified ones is the same class of untruth Phase 7 removed
 * from the USDC path.
 *
 * An asset is chain-backed when it is an ERC-20 on an EVM chain this process
 * can reach: it has a contract address, and its chain has a configured RPC.
 * Everything else is reported as manually recorded, explicitly, everywhere.
 *
 * Non-EVM assets (BTC, SOL) need a different client entirely and are out of
 * scope here — they stay manual, and say so.
 */
import { createPublicClient, erc20Abi, http, type Address, type PublicClient } from "viem";
import { base, baseSepolia, mainnet } from "viem/chains";
import type { AssetRecord } from "@policyvault/common";
import { activeChain, rpcUrl } from "./network.js";

/** EVM chains an asset may be pinned to. Extend with the chain and its RPC env. */
const EVM_CHAINS = {
  "base-sepolia": {
    chain: baseSepolia,
    name: "Base Sepolia",
    rpcEnv: ["CHAIN_RPC_URL", "BASE_RPC_URL", "BASE_SEPOLIA_RPC_URL"],
    defaultRpc: "https://sepolia.base.org",
    explorerAddress: (a: string) => `https://sepolia.basescan.org/address/${a}`,
  },
  base: {
    chain: base,
    name: "Base",
    rpcEnv: ["CHAIN_RPC_URL", "BASE_RPC_URL"],
    defaultRpc: "https://mainnet.base.org",
    explorerAddress: (a: string) => `https://basescan.org/address/${a}`,
  },
  ethereum: {
    chain: mainnet,
    name: "Ethereum",
    // No public default: a mainnet read against an unfunded public endpoint
    // fails in ways that look like drift. Require an explicit RPC.
    rpcEnv: ["ETHEREUM_RPC_URL", "MAINNET_RPC_URL"],
    defaultRpc: null,
    explorerAddress: (a: string) => `https://etherscan.io/address/${a}`,
  },
} as const;

export type EvmChainId = keyof typeof EVM_CHAINS;

export type AssetBackingKind =
  | "chain"
  /** ERC-20 on a chain we know, but no RPC is configured for it. */
  | "chain-unconfigured"
  /** Native coin or non-EVM chain — no adapter exists. */
  | "manual";

export type AssetBackingInfo = {
  assetId: string;
  symbol: string;
  chain: string;
  contract: string | null;
  kind: AssetBackingKind;
  /** Why this asset is not chain-backed. Present when kind !== "chain". */
  reason?: string;
  explorerAddress?: string;
};

function evmChainFor(chain: string): (typeof EVM_CHAINS)[EvmChainId] | undefined {
  return EVM_CHAINS[chain as EvmChainId];
}

function rpcFor(chain: string): string | null {
  const cfg = evmChainFor(chain);
  if (!cfg) return null;
  for (const key of cfg.rpcEnv) {
    const v = process.env[key]?.trim();
    if (v) return v;
  }
  // The active chain's resolver already handles its own env precedence.
  if (chain === activeChain().id) return rpcUrl();
  return cfg.defaultRpc;
}

/** How an asset is backed, and why — the string the console shows the user. */
export function assetBacking(asset: AssetRecord): AssetBackingInfo {
  const base_: AssetBackingInfo = {
    assetId: asset.id,
    symbol: asset.symbol,
    chain: asset.chain,
    contract: asset.contract ?? null,
    kind: "manual",
  };
  const evm = evmChainFor(asset.chain);
  if (!evm) {
    return {
      ...base_,
      reason: `No chain adapter for ${asset.chain}. Balances here are recorded by hand.`,
    };
  }
  if (!asset.contract) {
    return {
      ...base_,
      reason: `${asset.symbol} is a native coin on ${evm.name}; only ERC-20 balances are read on-chain today.`,
    };
  }
  if (!rpcFor(asset.chain)) {
    return {
      ...base_,
      kind: "chain-unconfigured",
      reason: `No RPC configured for ${evm.name}. Set ${evm.rpcEnv[0]} to read this balance on-chain.`,
    };
  }
  return { ...base_, kind: "chain" };
}

const clients = new Map<string, PublicClient>();

function clientFor(chain: string): PublicClient | null {
  const evm = evmChainFor(chain);
  const rpc = rpcFor(chain);
  if (!evm || !rpc) return null;
  const key = `${chain}:${rpc}`;
  const existing = clients.get(key);
  if (existing) return existing;
  const client = createPublicClient({
    chain: evm.chain,
    transport: http(rpc, { timeout: 20_000 }),
  }) as PublicClient;
  clients.set(key, client);
  return client;
}

export type AssetOnchainRead = {
  assetId: string;
  symbol: string;
  backing: AssetBackingInfo;
  /** Null when the asset is not chain-backed or the read failed. */
  onchainMicro: string | null;
  error?: string;
};

/**
 * Read one asset's real balance at an address.
 *
 * Returns `onchainMicro: null` rather than 0 when the balance is unknown —
 * a failed read must never be mistaken for an empty wallet.
 */
export async function readAssetOnchain(
  asset: AssetRecord,
  holder: string | undefined,
): Promise<AssetOnchainRead> {
  const backing = assetBacking(asset);
  const out: AssetOnchainRead = {
    assetId: asset.id,
    symbol: asset.symbol,
    backing,
    onchainMicro: null,
  };
  if (backing.kind !== "chain") return { ...out, error: backing.reason };
  if (!holder || !/^0x[a-fA-F0-9]{40}$/.test(holder)) {
    return { ...out, error: "No vault address for this org" };
  }
  const client = clientFor(asset.chain);
  if (!client) return { ...out, error: "No RPC client for this chain" };

  try {
    const balance = await client.readContract({
      address: asset.contract as Address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [holder as Address],
    });
    return {
      ...out,
      onchainMicro: balance.toString(),
      backing: {
        ...backing,
        explorerAddress: evmChainFor(asset.chain)?.explorerAddress(holder),
      },
    };
  } catch (e) {
    return { ...out, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Read every chain-backed asset for an org's vault, concurrently. */
export async function readAssetsOnchain(
  assets: AssetRecord[],
  holder: string | undefined,
): Promise<AssetOnchainRead[]> {
  return Promise.all(assets.map((a) => readAssetOnchain(a, holder)));
}
