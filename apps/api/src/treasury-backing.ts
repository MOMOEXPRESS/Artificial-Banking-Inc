/**
 * On-chain reconciliation — does the ledger agree with the chain?
 *
 * `store.reconcileOrg` replays journals against account balances. That proves
 * the books agree with *themselves*, which they can do while being arbitrarily
 * far from reality: before Phase 7 an org could mint balance from the
 * `external` contra account with no on-chain event at all, and the mock rail
 * booked outflows that never left the vault.
 *
 * This module closes that gap by comparing the vault's real USDC balance
 * against what the books say it should be:
 *
 *     expected = -(external) - unbacked
 *
 * Every internal credit is matched by a debit to `external`, so `-(external)`
 * is the net money the ledger believes it holds. `unbacked` is the running
 * total of simulated movements (sandbox deposits, mock-rail settlements,
 * book-only withdrawals), which never touched the chain.
 *
 * Drift is money that moved without the books noticing, or books that moved
 * without money. Either way it needs a human.
 */
import { formatMicroToUsdc } from "@policyvault/common";
import { readVaultOnchain } from "./chain/deposits.js";
import { recordObs } from "./platform/observability.js";
import { store } from "./store.js";
import { emitEvent } from "./webhooks.js";

export type OnchainBackingReport = {
  ok: boolean;
  /** False when the vault could not be read — unknown, not reconciled. */
  checked: boolean;
  orgId: string;
  ledgerMode: "sandbox" | "live";
  error?: string;
  vaultAddress?: string;
  network?: string;
  onchainMicro: string;
  onchainUsdc: string;
  expectedMicro: string;
  expectedUsdc: string;
  /** onchain - expected. Positive: unexplained funds. Negative: missing funds. */
  driftMicro: string;
  driftUsdc: string;
  unbackedMicro: string;
  unbackedUsdc: string;
  at: string;
};

/**
 * Tolerance, in micro-USDC. Zero: this is an exact-integer ledger against an
 * exact-integer token balance, and any nonzero tolerance is a place for real
 * drift to hide.
 */
const DRIFT_TOLERANCE_MICRO = 0n;

export async function reconcileOrgOnchain(orgId: string): Promise<OnchainBackingReport> {
  const at = new Date().toISOString();
  const ledgerMode = store.getOrgLedgerMode(orgId);
  const expected = store.expectedOnchainMicro(orgId);
  const unbacked = store.getUnbackedMicro(orgId);
  const vaultAddress = store.getVaultAddress(orgId);
  const snap = await readVaultOnchain(vaultAddress);

  if (!snap.ok) {
    // An unreadable vault is not a clean reconciliation. Say "unknown" rather
    // than reporting ok on the strength of an RPC failure.
    return {
      ok: false,
      checked: false,
      orgId,
      ledgerMode,
      error: snap.error ?? "Could not read vault on-chain",
      vaultAddress,
      network: snap.network,
      onchainMicro: "0",
      onchainUsdc: "0.00",
      expectedMicro: expected.toString(),
      expectedUsdc: formatMicroToUsdc(expected),
      driftMicro: "0",
      driftUsdc: "0.00",
      unbackedMicro: unbacked.toString(),
      unbackedUsdc: formatMicroToUsdc(unbacked),
      at,
    };
  }

  const onchain = BigInt(snap.onchainBalanceMicro);
  const drift = onchain - expected;
  const ok = (drift < 0n ? -drift : drift) <= DRIFT_TOLERANCE_MICRO;

  return {
    ok,
    checked: true,
    orgId,
    ledgerMode,
    vaultAddress,
    network: snap.network,
    onchainMicro: onchain.toString(),
    onchainUsdc: snap.onchainBalanceUsdc,
    expectedMicro: expected.toString(),
    expectedUsdc: formatMicroToUsdc(expected),
    driftMicro: drift.toString(),
    driftUsdc: formatMicroToUsdc(drift),
    unbackedMicro: unbacked.toString(),
    unbackedUsdc: formatMicroToUsdc(unbacked),
    at,
  };
}

/**
 * Sweep every org and raise the alarm on drift.
 *
 * Sandbox orgs are checked too — their expected balance accounts for the
 * simulated money, so a sandbox org with real deposits still reconciles.
 */
export async function runOnchainBackingSweep(): Promise<{
  checked: number;
  drifted: number;
  unreadable: number;
}> {
  let checked = 0;
  let drifted = 0;
  let unreadable = 0;

  for (const orgId of store.listOrgIds()) {
    const report = await reconcileOrgOnchain(orgId);
    if (!report.checked) {
      unreadable++;
      continue;
    }
    checked++;
    if (report.ok) continue;

    drifted++;
    // Loudest signal this system produces: the books and the chain disagree
    // about how much money exists.
    console.error(
      `ONCHAIN DRIFT org=${orgId} onchain=${report.onchainUsdc} expected=${report.expectedUsdc} drift=${report.driftUsdc}`,
    );
    recordObs({
      name: "reconcile.onchainDrift",
      orgId,
      attrs: {
        driftUsdc: report.driftUsdc,
        onchainUsdc: report.onchainUsdc,
        expectedUsdc: report.expectedUsdc,
        ledgerMode: report.ledgerMode,
      },
    });
    emitEvent(orgId, "treasury.drift.detected", {
      onchainUsdc: report.onchainUsdc,
      expectedUsdc: report.expectedUsdc,
      driftUsdc: report.driftUsdc,
      vaultAddress: report.vaultAddress,
      at: report.at,
    });
  }

  return { checked, drifted, unreadable };
}
