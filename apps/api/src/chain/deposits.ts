/**
 * On-chain USDC deposit detection for the org vault EOA.
 * Reads balanceOf + Transfer logs; callers credit the ledger idempotently.
 */
import { formatMicroToUsdc } from "@policyvault/common";
import {
  createPublicClient,
  http,
  parseAbiItem,
  type Address,
  type Hex,
} from "viem";
import { base, baseSepolia } from "viem/chains";
import { activeChain, rpcUrl, type ChainConfig } from "./network.js";

const transferEvent = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

const erc20Abi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

/**
 * Public Base Sepolia RPCs reject eth_getLogs when (to - from) > ~2000.
 * Keep each chunk at most 2000 inclusive blocks (to = from + 1999).
 * Walk several chunks so Sync still covers recent history (~10k blocks).
 */
const MAX_LOG_RANGE = 2_000n;
const SCAN_CHUNKS = 5n;

export type DetectedTransfer = {
  txHash: Hex;
  logIndex: number;
  blockNumber: string;
  from: Address;
  to: Address;
  amountMicro: string;
  amountUsdc: string;
  explorerUrl: string;
};

export type OnchainVaultSnapshot = {
  ok: boolean;
  error?: string;
  network: ChainConfig["id"];
  networkName: string;
  chainId: number;
  rpc: string;
  vaultAddress: Address | null;
  usdcContract: Address;
  explorerAddress?: string;
  onchainBalanceMicro: string;
  onchainBalanceUsdc: string;
  blockNumber: string;
  transfers: DetectedTransfer[];
  scannedFromBlock: string;
  scannedToBlock: string;
};

function clientFor(cfg: ChainConfig) {
  const chain = cfg.id === "base" ? base : baseSepolia;
  return createPublicClient({
    chain,
    transport: http(rpcUrl(cfg), { timeout: 20_000 }),
  });
}

type TransferLog = {
  args: { from?: Address; to?: Address; value?: bigint };
  transactionHash: Hex | null;
  logIndex: number | null;
  blockNumber: bigint | null;
};

async function getTransferLogsChunked(
  client: ReturnType<typeof clientFor>,
  cfg: ChainConfig,
  vault: Address,
  latest: bigint,
): Promise<{ logs: TransferLog[]; fromBlock: bigint }> {
  const totalWindow = MAX_LOG_RANGE * SCAN_CHUNKS;
  const fromBlock = latest > totalWindow ? latest - totalWindow : 0n;
  const logs: TransferLog[] = [];

  for (let start = fromBlock; start <= latest; start += MAX_LOG_RANGE) {
    let end = start + MAX_LOG_RANGE - 1n;
    if (end > latest) end = latest;
    const chunk = await client.getLogs({
      address: cfg.usdc,
      event: transferEvent,
      args: { to: vault },
      fromBlock: start,
      toBlock: end,
    });
    logs.push(...(chunk as TransferLog[]));
  }

  return { logs, fromBlock };
}

export async function readVaultOnchain(vaultAddress: string | undefined): Promise<OnchainVaultSnapshot> {
  const cfg = activeChain();
  const baseSnap: OnchainVaultSnapshot = {
    ok: false,
    network: cfg.id,
    networkName: cfg.name,
    chainId: cfg.chainId,
    rpc: rpcUrl(cfg),
    vaultAddress: null,
    usdcContract: cfg.usdc,
    explorerAddress: undefined,
    onchainBalanceMicro: "0",
    onchainBalanceUsdc: "0.00",
    blockNumber: "0",
    transfers: [],
    scannedFromBlock: "0",
    scannedToBlock: "0",
  };

  if (!vaultAddress || !/^0x[a-fA-F0-9]{40}$/.test(vaultAddress)) {
    return { ...baseSnap, error: "No vault address for this org" };
  }

  const vault = vaultAddress as Address;
  try {
    const client = clientFor(cfg);
    const latest = await client.getBlockNumber();

    const [balance, { logs, fromBlock }] = await Promise.all([
      client.readContract({
        address: cfg.usdc,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [vault],
      }),
      getTransferLogsChunked(client, cfg, vault, latest),
    ]);

    const transfers: DetectedTransfer[] = logs
      .map((log) => {
        const args = log.args;
        const value = args.value ?? 0n;
        const hash = log.transactionHash!;
        return {
          txHash: hash,
          logIndex: log.logIndex ?? 0,
          blockNumber: (log.blockNumber ?? 0n).toString(),
          from: (args.from ?? "0x0000000000000000000000000000000000000000") as Address,
          to: vault,
          amountMicro: value.toString(),
          amountUsdc: formatMicroToUsdc(value),
          explorerUrl: cfg.explorerTx(hash),
        };
      })
      .sort((a, b) => Number(b.blockNumber) - Number(a.blockNumber));

    return {
      ok: true,
      network: cfg.id,
      networkName: cfg.name,
      chainId: cfg.chainId,
      rpc: rpcUrl(cfg),
      vaultAddress: vault,
      usdcContract: cfg.usdc,
      explorerAddress: cfg.explorerAddress(vault),
      onchainBalanceMicro: balance.toString(),
      onchainBalanceUsdc: formatMicroToUsdc(balance),
      blockNumber: latest.toString(),
      transfers,
      scannedFromBlock: fromBlock.toString(),
      scannedToBlock: latest.toString(),
    };
  } catch (e) {
    return {
      ...baseSnap,
      vaultAddress: vault,
      explorerAddress: cfg.explorerAddress(vault),
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
