/**
 * Owner-only ledger-mode switch (sandbox <-> live) for testnet orgs.
 * Pure helpers so they can be unit tested with node:test.
 */
export type LedgerMode = "sandbox" | "live";

export function nextLedgerMode(current: string | null | undefined): LedgerMode {
  return current === "live" ? "sandbox" : "live";
}

export function ledgerModeSwitchRequest(
  orgId: string,
  mode: LedgerMode,
): { path: string; init: RequestInit } {
  return {
    path: `/v1/auth/orgs/${encodeURIComponent(orgId)}/ledger-mode`,
    init: { method: "POST", body: JSON.stringify({ mode }) },
  };
}

export function ledgerModeToggleLabel(current: string | null | undefined): string {
  return current === "live" ? "Switch to sandbox" : "Switch to live";
}

export function ledgerModeToggleHelp(current: string | null | undefined): string {
  return current === "live"
    ? "Sandbox lets you add simulated balance for demos. Agent wallet payments still send real testnet USDC."
    : "Live: Treasury sends broadcast real testnet USDC from the vault and simulated top-ups are disabled. Remove any simulated balance first.";
}
