/**
 * Credit org vault ledger from on-chain USDC Transfer-ins.
 * Shared by manual POST sync, GET auto-sync, and background sweeps.
 */
import { formatMicroToUsdc } from "@policyvault/common";
import { readVaultOnchain, type OnchainVaultSnapshot } from "./deposits.js";
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
  snap: OnchainVaultSnapshot;
  newly: CreditedDeposit[];
  ledgerAvailableUsdc: string;
};

export async function syncOrgOnchainDeposits(orgId: string): Promise<SyncDepositsResult> {
  const snap = await readVaultOnchain(store.getVaultAddress(orgId));
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

  return {
    ok: true,
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
  return {
    credited,
    transfers: snap.transfers.map((t) => ({
      ...t,
      status: creditedKeys.has(`${t.txHash.toLowerCase()}:${t.logIndex}`)
        ? ("credited" as const)
        : ("detected" as const),
    })),
  };
}

/** Coalesce so Vercel/request paths don't hammer RPC on every hit. */
let lastDepositSweepAt = 0;
const DEPOSIT_SWEEP_MIN_GAP_MS = 20_000;

/**
 * Scan every org vault for new USDC Transfer-ins and credit the ledger.
 * Safe to call from setInterval or opportunistically on guardian/agent traffic.
 */
export async function runOnchainDepositSweep(opts?: {
  force?: boolean;
}): Promise<{ orgs: number; credited: number }> {
  const now = Date.now();
  if (!opts?.force && now - lastDepositSweepAt < DEPOSIT_SWEEP_MIN_GAP_MS) {
    return { orgs: 0, credited: 0 };
  }
  lastDepositSweepAt = now;

  let credited = 0;
  const orgIds = store.listOrgIds();
  for (const orgId of orgIds) {
    try {
      const result = await syncOrgOnchainDeposits(orgId);
      credited += result.newly.length;
    } catch (e) {
      console.error(`onchain deposit sweep failed org=${orgId}:`, e);
    }
  }
  return { orgs: orgIds.length, credited };
}
