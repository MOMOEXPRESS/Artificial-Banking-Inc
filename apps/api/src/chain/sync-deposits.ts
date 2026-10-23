/**
 * Credit org vault ledger from on-chain USDC Transfer-ins.
 * Shared by manual POST sync, GET auto-sync, and background sweeps.
 */
import { formatMicroToUsdc } from "@policyvault/common";
import { readVaultOnchain, type OnchainVaultSnapshot, type ReadVaultOptions } from "./deposits.js";
import { activeChain } from "./network.js";
import { rpcRemaining } from "./rpc-budget.js";
import { store } from "../store.js";
import { recordObs } from "../platform/observability.js";
import { emitEvent } from "../webhooks.js";

export type CreditedDeposit = {
  txHash: string;
  logIndex: number;
  amountUsdc: string;
  explorerUrl: string;
  blockNumber: string;
  from: string;
};

export type SyncDepositsResult = {
  ok: boolean;
  error?: string;
  /** Balance read fine, but the Transfer-log scan failed (cursor not advanced). */
  logsError?: string;
  snap: OnchainVaultSnapshot;
  newly: CreditedDeposit[];
  ledgerAvailableUsdc: string;
};

export type SyncDepositsOptions = {
  /** eth_getLogs calls this sync may spend (Workers subrequest budget). */
  maxLogCalls?: number;
  /** Test hook: forwarded to readVaultOnchain. */
  client?: ReadVaultOptions["client"];
};

/**
 * Read the vault, scan Transfer-ins since this vault's cursor, credit any new
 * deposits, then advance the cursor to the last block fully scanned.
 *
 * `ok` reflects the balance read. A failed log scan leaves the cursor where it
 * was (nothing is skipped) and is reported as `logsError`, not as a chain
 * outage.
 */
export async function syncOrgOnchainDeposits(
  orgId: string,
  opts: SyncDepositsOptions = {},
): Promise<SyncDepositsResult> {
  const vault = store.getVaultAddress(orgId);
  const chain = activeChain().id;
  const cursor = vault ? store.getOnchainScanCursor(orgId, chain, vault) : undefined;
  const snap = await readVaultOnchain(vault, {
    afterBlock: cursor,
    maxLogCalls: opts.maxLogCalls,
    client: opts.client,
  });
  if (!snap.ok) {
    return {
      ok: false,
      error: snap.error ?? "Could not read vault on-chain",
      snap,
      newly: [],
      ledgerAvailableUsdc: formatMicroToUsdc(
        store.getAccountMap(orgId).get(`org:${orgId}:available`)?.balanceMicro ?? 0n,
      ),
    };
  }

  const newly: CreditedDeposit[] = [];
  for (const t of snap.transfers) {
    const result = store.creditOnchainUsdcDeposit({
      orgId,
      chain: snap.network,
      txHash: t.txHash,
      logIndex: t.logIndex,
      blockNumber: t.blockNumber,
      from: t.from,
      to: t.to,
      amountMicro: BigInt(t.amountMicro),
    });
    if (result.credited) {
      newly.push({
        txHash: t.txHash,
        logIndex: t.logIndex,
        amountUsdc: t.amountUsdc,
        explorerUrl: t.explorerUrl,
        blockNumber: t.blockNumber,
        from: t.from,
      });
      recordObs({
        name: "treasury.onchain_deposit",
        orgId,
        attrs: { txHash: t.txHash, amountUsdc: t.amountUsdc, network: snap.network },
      });
      emitEvent(orgId, "treasury.onchain_deposit", {
        txHash: t.txHash,
        amountUsdc: t.amountUsdc,
        network: snap.network,
        explorerUrl: t.explorerUrl,
      });
    }
  }

  // Only after crediting: a crash between the two re-scans, never skips.
  if (vault && snap.scannedThrough !== null) {
    store.setOnchainScanCursor(orgId, snap.network, vault, BigInt(snap.scannedThrough));
  }

  return {
    ok: true,
    ...(snap.logsError ? { logsError: snap.logsError } : {}),
    snap,
    newly,
    ledgerAvailableUsdc: formatMicroToUsdc(
      store.getAccountMap(orgId).get(`org:${orgId}:available`)?.balanceMicro ?? 0n,
    ),
  };
}

export function decorateOnchainTransfers(snap: OnchainVaultSnapshot, orgId: string) {
  const credited = store.listOnchainDeposits(orgId);
  const creditedKeys = new Set(credited.map((d) => `${d.txHash}:${d.logIndex}`));
  const scanned = snap.transfers.map((t) => ({
    ...t,
    status: creditedKeys.has(`${t.txHash.toLowerCase()}:${t.logIndex}`)
      ? ("credited" as const)
      : ("detected" as const),
  }));
  // A cursor scan only returns blocks since the last sweep, so fold in deposits
  // credited earlier — "Recent deposits" must not empty out once scanned.
  const seen = new Set(scanned.map((t) => `${t.txHash.toLowerCase()}:${t.logIndex}`));
  const cfg = activeChain();
  const history = credited
    .filter((d) => !seen.has(`${d.txHash}:${d.logIndex}`))
    .map((d) => ({
      txHash: d.txHash as `0x${string}`,
      logIndex: d.logIndex,
      blockNumber: d.blockNumber,
      from: d.from as `0x${string}`,
      to: d.to as `0x${string}`,
      amountMicro: d.amountMicro,
      amountUsdc: formatMicroToUsdc(BigInt(d.amountMicro)),
      explorerUrl: cfg.explorerTx(d.txHash),
      status: "credited" as const,
    }));
  return {
    credited,
    transfers: [...scanned, ...history].sort(
      (a, b) => Number(b.blockNumber) - Number(a.blockNumber),
    ),
  };
}

/** Coalesce so request paths don't hammer RPC on every hit. */
let lastDepositSweepAt = 0;
const DEPOSIT_SWEEP_MIN_GAP_MS = 20_000;
/**
 * RPC calls one sweep may spend in total. Cloudflare Workers caps subrequests
 * per invocation (50 on the free plan) and the alarm shares that budget with
 * every other job, so stay well under it. Each org costs 3 balance reads plus
 * its log calls; orgs that do not fit this tick go first next tick.
 */
const SWEEP_SUBREQUEST_BUDGET = Number(process.env.ABI_DEPOSIT_SWEEP_BUDGET ?? 30);
const BALANCE_CALLS_PER_ORG = 3;
const MIN_LOG_CALLS_PER_ORG = 1;
const MAX_LOG_CALLS_PER_ORG = 4;
let sweepOffset = 0;

/**
 * Scan org vaults for new USDC Transfer-ins and credit the ledger, round-robin
 * within a fixed subrequest budget. Safe to call from the alarm or
 * opportunistically on console traffic.
 */
export async function runOnchainDepositSweep(opts?: {
  force?: boolean;
  /** Restrict to these orgs (request path syncs only the caller's org). */
  orgIds?: string[];
  budget?: number;
  client?: ReadVaultOptions["client"];
}): Promise<{ orgs: number; credited: number; skipped: number; logErrors: number }> {
  const now = Date.now();
  if (!opts?.force && now - lastDepositSweepAt < DEPOSIT_SWEEP_MIN_GAP_MS) {
    return { orgs: 0, credited: 0, skipped: 0, logErrors: 0 };
  }
  lastDepositSweepAt = now;

  const all = (opts?.orgIds ?? store.listOrgIds()).filter((id) => store.getVaultAddress(id));
  if (all.length === 0) return { orgs: 0, credited: 0, skipped: 0, logErrors: 0 };
  const start = opts?.orgIds ? 0 : sweepOffset % all.length;
  const ordered = [...all.slice(start), ...all.slice(0, start)];

  let budget = opts?.budget ?? SWEEP_SUBREQUEST_BUDGET;
  let localLeft = budget;
  let credited = 0;
  let done = 0;
  let logErrors = 0;
  for (const orgId of ordered) {
    // Also respect the tick's shared RPC budget (alarm), when there is one.
    const shared = rpcRemaining();
    if (shared !== null) budget = Math.min(localLeft, shared);
    const logCalls = Math.min(MAX_LOG_CALLS_PER_ORG, budget - BALANCE_CALLS_PER_ORG);
    if (logCalls < MIN_LOG_CALLS_PER_ORG) break;
    try {
      const result = await syncOrgOnchainDeposits(orgId, {
        maxLogCalls: logCalls,
        client: opts?.client,
      });
      credited += result.newly.length;
      if (result.logsError) logErrors += 1;
      if (!result.ok || result.logsError) {
        console.error(
          `onchain deposit sweep org=${orgId}: ${result.error ?? result.logsError ?? "unknown"}`,
        );
      }
    } catch (e) {
      console.error(`onchain deposit sweep failed org=${orgId}:`, e);
    }
    // Inside a shared tick budget, readVaultOnchain charges each real call, so
    // the local cap tracks actual use. Without one, charge the worst case.
    const after = rpcRemaining();
    const used =
      shared !== null && after !== null ? shared - after : BALANCE_CALLS_PER_ORG + logCalls;
    localLeft -= used;
    budget = localLeft;
    done += 1;
  }
  if (!opts?.orgIds) sweepOffset = (start + done) % all.length;
  return { orgs: done, credited, skipped: all.length - done, logErrors };
}

/** Test hook. */
export function resetDepositSweepState(): void {
  lastDepositSweepAt = 0;
  sweepOffset = 0;
}
