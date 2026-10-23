/**
 * On-chain USDC deposit detection for the org vault EOA.
 *
 * Two independent reads:
 *   - balances (block number, USDC balanceOf, native ETH) — three RPC calls,
 *     always attempted, never hidden by a log-scan failure;
 *   - Transfer-in logs, paged to the node's eth_getLogs range limit and
 *     resumable from a per-vault cursor so each tick only scans new blocks.
 *
 * Callers credit the ledger idempotently (tx hash + log index).
 */
import { formatMicroToUsdc } from "@policyvault/common";
import { createPublicClient, http, parseAbiItem, type Address, type Hex } from "viem";
import { base, baseSepolia } from "viem/chains";
import { activeChain, rpcUrl, type ChainConfig } from "./network.js";
import { RPC_BUDGET_EXHAUSTED, tryTakeRpc } from "./rpc-budget.js";

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
 * Inclusive block span per eth_getLogs call.
 *
 * sepolia.base.org answers HTTP 413 "eth_getLogs is limited to a 200 range"
 * for anything wider (it used to allow ~2000, which is what broke every vault
 * read in production). Start at 200; a node that is stricter still is detected
 * from its error and the span is halved or set to the limit it states.
 */
export const DEFAULT_LOG_RANGE = 200n;
/** When a vault has no cursor yet, look back this far (~5.5h on Base). */
export const INITIAL_LOOKBACK_BLOCKS = 10_000n;
/** Stay a couple of blocks behind head so a shallow reorg cannot skip a log. */
export const CONFIRMATIONS = 2n;
/** Default eth_getLogs calls one scan may spend (Workers subrequest budget). */
export const DEFAULT_LOG_CALLS = 6;

function envRange(): bigint {
  const raw = process.env.CHAIN_LOG_RANGE?.trim();
  if (raw && /^\d+$/.test(raw) && BigInt(raw) > 0n) return BigInt(raw);
  return DEFAULT_LOG_RANGE;
}

/** Learned per-RPC limit, so one 413 teaches every later scan. */
const learnedRange = new Map<string, bigint>();

export function logRangeFor(rpc: string): bigint {
  const learned = learnedRange.get(rpc);
  const configured = envRange();
  return learned !== undefined && learned < configured ? learned : configured;
}

/** Test hook. */
export function resetLearnedLogRanges(): void {
  learnedRange.clear();
}

/**
 * Is this error the node refusing the block span (as opposed to an outage)?
 * Returns the limit the node states, `0n` when it refuses without a number,
 * or `null` when the error is something else.
 */
export function logRangeLimitFromError(e: unknown): bigint | null {
  const parts: string[] = [];
  let cur: unknown = e;
  for (let i = 0; i < 6 && cur; i++) {
    if (cur instanceof Error) {
      parts.push(cur.message);
      const details = (cur as { details?: unknown }).details;
      if (typeof details === "string") parts.push(details);
      const status = (cur as { status?: unknown }).status;
      if (status === 413) parts.push("http 413");
      cur = (cur as { cause?: unknown }).cause;
    } else {
      parts.push(String(cur));
      break;
    }
  }
  const msg = parts.join(" | ").toLowerCase();
  const stated =
    /limited to (?:a )?(\d+)(?: block)? range/.exec(msg) ??
    /block range (?:is )?(?:limited to|too large[^\d]*|exceeds?[^\d]*)(\d+)/.exec(msg) ??
    /(?:max(?:imum)?|up to) (\d+) blocks?/.exec(msg);
  if (stated) return BigInt(stated[1]);
  if (
    /\b413\b|payload too large|block range|range (?:is )?too (?:large|wide)|limited to|query returned more than|too many (?:blocks|results)|exceed/.test(
      msg,
    )
  ) {
    return 0n;
  }
  return null;
}

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
  /** Balances were read. A failed log scan does not clear this. */
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
  /** Native ETH (wei) on the vault — required for gas on agent USDC transfers. */
  nativeBalanceWei: string;
  nativeBalanceEth: string;
  hasGas: boolean;
  blockNumber: string;
  transfers: DetectedTransfer[];
  scannedFromBlock: string;
  scannedToBlock: string;
  /** Whether the Transfer-log scan completed for the range it attempted. */
  logsOk: boolean;
  logsError?: string;
  /** Highest block fully scanned this call (resume after it); null when nothing was scanned. */
  scannedThrough: string | null;
  /** True when the scan stopped at its call budget before reaching the safe head. */
  scanIncomplete: boolean;
};

export type ReadVaultOptions = {
  /**
   * Skip the log scan entirely (balances only). Gas monitor, backing sweep and
   * the rotation guard only need balances.
   */
  balancesOnly?: boolean;
  /** Resume after this block. Undefined → INITIAL_LOOKBACK_BLOCKS before head. */
  afterBlock?: bigint;
  /** Max eth_getLogs calls for this scan. */
  maxLogCalls?: number;
  /** Test hook: inject a client. */
  client?: VaultReadClient;
};

/** The subset of a viem PublicClient this module uses (lets tests mock the RPC). */
export type VaultReadClient = {
  getBlockNumber: () => Promise<bigint>;
  readContract: (args: {
    address: Address;
    abi: typeof erc20Abi;
    functionName: "balanceOf";
    args: readonly [Address];
  }) => Promise<bigint>;
  getBalance: (args: { address: Address }) => Promise<bigint>;
  getLogs: (args: {
    address: Address;
    event: typeof transferEvent;
    args: { to: Address };
    fromBlock: bigint;
    toBlock: bigint;
  }) => Promise<unknown[]>;
};

function clientFor(cfg: ChainConfig): VaultReadClient {
  const chain = cfg.id === "base" ? base : baseSepolia;
  return createPublicClient({
    chain,
    transport: http(rpcUrl(cfg), { timeout: 20_000 }),
  }) as unknown as VaultReadClient;
}

type TransferLog = {
  args: { from?: Address; to?: Address; value?: bigint };
  transactionHash: Hex | null;
  logIndex: number | null;
  blockNumber: bigint | null;
};

export type LogScanResult = {
  logs: TransferLog[];
  /** Highest block fully covered; `from - 1` when nothing was covered. */
  through: bigint;
  complete: boolean;
  calls: number;
  error?: string;
};

/**
 * Scan USDC Transfer(to = vault) logs over [from, to], paging to the node's
 * range limit. On a range refusal the span shrinks (to the stated limit, or
 * by half) and the same window is retried; the learned span is remembered per
 * RPC. Stops at `maxCalls` and reports how far it got, so callers can persist
 * a cursor and continue next tick.
 */
export async function scanTransferLogs(input: {
  client: VaultReadClient;
  rpc: string;
  usdc: Address;
  vault: Address;
  from: bigint;
  to: bigint;
  maxCalls: number;
}): Promise<LogScanResult> {
  const { client, rpc, usdc, vault, from, to, maxCalls } = input;
  const logs: TransferLog[] = [];
  let through = from - 1n;
  let calls = 0;
  let span = logRangeFor(rpc);

  let start = from;
  while (start <= to) {
    if (calls >= maxCalls) {
      return { logs, through, complete: false, calls };
    }
    if (!tryTakeRpc(1)) {
      return { logs, through, complete: false, calls };
    }
    let end = start + span - 1n;
    if (end > to) end = to;
    calls += 1;
    try {
      const chunk = await client.getLogs({
        address: usdc,
        event: transferEvent,
        args: { to: vault },
        fromBlock: start,
        toBlock: end,
      });
      logs.push(...(chunk as TransferLog[]));
      through = end;
      start = end + 1n;
    } catch (e) {
      const limit = logRangeLimitFromError(e);
      const width = end - start + 1n;
      if (limit === null || width <= 1n) {
        return {
          logs,
          through,
          complete: false,
          calls,
          error: e instanceof Error ? e.message.split("\n")[0] : String(e),
        };
      }
      // Some nodes state the limit as (to - from); others as the inclusive count.
      // Using the stated number as the inclusive count satisfies both.
      let next = limit > 0n && limit < width ? limit : width / 2n;
      if (next < 1n) next = 1n;
      span = next;
      learnedRange.set(rpc, next);
    }
  }
  return { logs, through, complete: true, calls };
}

/**
 * Balance reads are shared for a few seconds, so the gas monitor and backing
 * sweep in the same alarm tick reuse the deposit sweep's reads instead of
 * spending three more subrequests per org. Short enough that a console
 * Refresh still shows a fresh balance moments after a transfer.
 */
const BALANCE_CACHE_MS = 15_000;
const balanceCache = new Map<
  string,
  { at: number; latest: bigint; balance: bigint; ethBal: bigint }
>();

/** Drop cached balance reads (after a send, or in tests). */
export function clearVaultBalanceCache(): void {
  balanceCache.clear();
}

function formatEth(wei: bigint): string {
  const whole = wei / 10n ** 18n;
  const frac = (wei % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "").slice(0, 6);
  return frac ? `${whole}.${frac}` : whole.toString();
}

export async function readVaultOnchain(
  vaultAddress: string | undefined,
  opts: ReadVaultOptions = {},
): Promise<OnchainVaultSnapshot> {
  const cfg = activeChain();
  const rpc = rpcUrl(cfg);
  const baseSnap: OnchainVaultSnapshot = {
    ok: false,
    network: cfg.id,
    networkName: cfg.name,
    chainId: cfg.chainId,
    rpc,
    vaultAddress: null,
    usdcContract: cfg.usdc,
    explorerAddress: undefined,
    onchainBalanceMicro: "0",
    onchainBalanceUsdc: "0.00",
    nativeBalanceWei: "0",
    nativeBalanceEth: "0",
    hasGas: false,
    blockNumber: "0",
    transfers: [],
    scannedFromBlock: "0",
    scannedToBlock: "0",
    logsOk: false,
    scannedThrough: null,
    scanIncomplete: false,
  };

  if (!vaultAddress || !/^0x[a-fA-F0-9]{40}$/.test(vaultAddress)) {
    return { ...baseSnap, error: "No vault address for this org" };
  }

  const vault = vaultAddress as Address;
  const client = opts.client ?? clientFor(cfg);
  let latest: bigint;
  let balance: bigint;
  let ethBal: bigint;
  const cacheKey = `${rpc}|${vault.toLowerCase()}`;
  const cached = opts.client ? undefined : balanceCache.get(cacheKey);
  try {
    if (cached && Date.now() - cached.at < BALANCE_CACHE_MS) {
      ({ latest, balance, ethBal } = cached);
    } else {
      if (!tryTakeRpc(3)) throw new Error(RPC_BUDGET_EXHAUSTED);
      [latest, balance, ethBal] = await Promise.all([
        client.getBlockNumber(),
        client.readContract({
          address: cfg.usdc,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [vault],
        }),
        client.getBalance({ address: vault }),
      ]);
      if (!opts.client) balanceCache.set(cacheKey, { at: Date.now(), latest, balance, ethBal });
    }
  } catch (e) {
    return {
      ...baseSnap,
      vaultAddress: vault,
      explorerAddress: cfg.explorerAddress(vault),
      error: e instanceof Error ? e.message.split("\n")[0] : String(e),
    };
  }

  const snap: OnchainVaultSnapshot = {
    ...baseSnap,
    ok: true,
    vaultAddress: vault,
    explorerAddress: cfg.explorerAddress(vault),
    onchainBalanceMicro: balance.toString(),
    onchainBalanceUsdc: formatMicroToUsdc(balance),
    nativeBalanceWei: ethBal.toString(),
    nativeBalanceEth: formatEth(ethBal),
    hasGas: ethBal > 0n,
    blockNumber: latest.toString(),
    scannedFromBlock: latest.toString(),
    scannedToBlock: latest.toString(),
  };
  if (opts.balancesOnly) return { ...snap, logsOk: true };

  const safeHead = latest > CONFIRMATIONS ? latest - CONFIRMATIONS : 0n;
  const from =
    opts.afterBlock !== undefined
      ? opts.afterBlock + 1n
      : safeHead > INITIAL_LOOKBACK_BLOCKS
        ? safeHead - INITIAL_LOOKBACK_BLOCKS
        : 0n;
  if (from > safeHead) {
    // Nothing new since the cursor.
    return {
      ...snap,
      logsOk: true,
      scannedFromBlock: from.toString(),
      scannedToBlock: safeHead.toString(),
      scannedThrough: opts.afterBlock !== undefined ? opts.afterBlock.toString() : null,
    };
  }

  const scan = await scanTransferLogs({
    client,
    rpc,
    usdc: cfg.usdc,
    vault,
    from,
    to: safeHead,
    maxCalls: Math.max(1, opts.maxLogCalls ?? DEFAULT_LOG_CALLS),
  });

  const transfers: DetectedTransfer[] = scan.logs
    .filter((log) => log.transactionHash)
    .map((log) => {
      const value = log.args.value ?? 0n;
      const hash = log.transactionHash!;
      return {
        txHash: hash,
        logIndex: log.logIndex ?? 0,
        blockNumber: (log.blockNumber ?? 0n).toString(),
        from: (log.args.from ?? "0x0000000000000000000000000000000000000000") as Address,
        to: vault,
        amountMicro: value.toString(),
        amountUsdc: formatMicroToUsdc(value),
        explorerUrl: cfg.explorerTx(hash),
      };
    })
    .sort((a, b) => Number(b.blockNumber) - Number(a.blockNumber));

  return {
    ...snap,
    transfers,
    scannedFromBlock: from.toString(),
    scannedToBlock: scan.through >= from ? scan.through.toString() : (from - 1n).toString(),
    logsOk: !scan.error,
    ...(scan.error ? { logsError: scan.error } : {}),
    scannedThrough: scan.through >= from ? scan.through.toString() : null,
    scanIncomplete: !scan.complete && !scan.error,
  };
}
