/**
 * Watch native-token balances on org vaults.
 *
 * Audit finding H7: each vault is a bare EOA that must hold ETH for gas, with
 * no monitoring at all. The failure surfaced mid-mission as `INSUFFICIENT_GAS`
 * and a message telling the operator to go fund an address by hand — which
 * contradicts the product's central promise that agents run unattended.
 *
 * This does not remove the requirement; only managed custody or a paymaster
 * does that (roadmap P4-T1 / P4-T3 proper). It converts a surprise into a
 * warning with enough lead time to act.
 */
import { readVaultOnchain } from "../chain/deposits.js";
import { isRpcBudgetError } from "../chain/rpc-budget.js";
import { rotate, rotationStart, saveRotation } from "./rotation.js";
import { notify } from "../platform/notifier.js";
import { recordObs } from "../platform/observability.js";
import { store } from "../store.js";
import { emitEvent } from "../webhooks.js";

/** Warn below this much native token. Roughly a few dozen Base transfers. */
function warnThresholdWei(): bigint {
  const raw = process.env.ABI_GAS_WARN_ETH ?? "0.002";
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 2_000_000_000_000_000n;
  return BigInt(Math.round(n * 1e18));
}

/** Do not re-alert the same org more often than this. */
const RENOTIFY_MS = Number(process.env.ABI_GAS_RENOTIFY_HOURS ?? 6) * 3600_000;
/** Last low-gas alert per org, persisted so DO eviction does not re-alert every tick. */
function lastAlertAt(orgId: string): number {
  const v = Number(store.getJobState(`gas-alert:${orgId}`) ?? 0);
  return Number.isFinite(v) ? v : 0;
}

export type GasCheck = {
  orgId: string;
  vaultAddress: string | null;
  nativeBalanceEth: string;
  low: boolean;
  empty: boolean;
};

export async function checkVaultGas(): Promise<{ checked: number; low: number }> {
  const threshold = warnThresholdWei();
  let checked = 0;
  let low = 0;

  const all = store.listOrgIds();
  const start = rotationStart("gas-monitor", all.length);
  let visited = 0;
  for (const orgId of rotate(all, start)) {
    const address = store.getVaultAddress(orgId);
    if (!address) {
      visited++;
      continue;
    }

    let snap;
    try {
      snap = await readVaultOnchain(address, { balancesOnly: true });
    } catch {
      // An RPC failure is not evidence of a low balance; skip rather than
      // alarm on it. RPC health is a separate concern.
      visited++;
      continue;
    }
    // Out of this tick's RPC allowance: stop; the next tick continues.
    if (!snap.ok && isRpcBudgetError(snap.error)) break;
    visited++;
    if (!snap.ok) continue;
    checked += 1;

    const wei = BigInt(snap.nativeBalanceWei);
    if (wei >= threshold) {
      // Recovered — allow an immediate alert if it drops again.
      if (lastAlertAt(orgId)) store.setJobState(`gas-alert:${orgId}`, "0");
      continue;
    }
    low += 1;

    recordObs({
      name: "treasury.gas_low",
      orgId,
      attrs: { address, nativeEth: snap.nativeBalanceEth, empty: wei === 0n },
    });

    const last = lastAlertAt(orgId);
    if (Date.now() - last < RENOTIFY_MS) continue;
    store.setJobState(`gas-alert:${orgId}`, String(Date.now()));

    const body =
      wei === 0n
        ? `The vault has no ${snap.networkName} ETH, so on-chain payments will fail. Send gas to ${address}.`
        : `The vault has ${snap.nativeBalanceEth} ETH left on ${snap.networkName}. Top up ${address} before agents are blocked.`;

    emitEvent(orgId, "treasury.recovery", {
      kind: "gas_low",
      address,
      nativeBalanceEth: snap.nativeBalanceEth,
      network: snap.network,
      empty: wei === 0n,
    });
    void notify({
      kind: "info",
      orgId,
      title: wei === 0n ? "Vault is out of gas" : "Vault gas running low",
      body,
      meta: { address, nativeBalanceEth: snap.nativeBalanceEth },
    });
  }

  saveRotation("gas-monitor", start, visited, all.length);
  return { checked, low };
}

/** Test-only: forget alert suppression between cases. */
export function resetGasAlertsForTests(): void {
  for (const orgId of store.listOrgIds()) store.setJobState(`gas-alert:${orgId}`, "0");
}
