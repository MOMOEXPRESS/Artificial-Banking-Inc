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
const lastAlertAt = new Map<string, number>();

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

  for (const orgId of store.listOrgIds()) {
    const address = store.getVaultAddress(orgId);
    if (!address) continue;

    let snap;
    try {
      snap = await readVaultOnchain(address);
    } catch {
      // An RPC failure is not evidence of a low balance; skip rather than
      // alarm on it. RPC health is a separate concern.
      continue;
    }
    if (!snap.ok) continue;
    checked += 1;

    const wei = BigInt(snap.nativeBalanceWei);
    if (wei >= threshold) {
      // Recovered — allow an immediate alert if it drops again.
      lastAlertAt.delete(orgId);
      continue;
    }
    low += 1;

    recordObs({
      name: "treasury.gas_low",
      orgId,
      attrs: { address, nativeEth: snap.nativeBalanceEth, empty: wei === 0n },
    });

    const last = lastAlertAt.get(orgId) ?? 0;
    if (Date.now() - last < RENOTIFY_MS) continue;
    lastAlertAt.set(orgId, Date.now());

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

  return { checked, low };
}

/** Test-only: forget alert suppression between cases. */
export function resetGasAlertsForTests(): void {
  lastAlertAt.clear();
}
