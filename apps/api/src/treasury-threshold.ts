/**
 * Treasury approval threshold — the one number that decides whether a
 * guardian-initiated treasury outflow runs now or waits for guardian review.
 *
 * It is a THRESHOLD, not a gate: nothing is ever refused because of it.
 *
 *   amount <= threshold  -> "allow"  (executes immediately)
 *   amount >  threshold  -> "review" (parked; executes once the org's approval
 *                                     quorum of guardians approves it)
 *
 * The hard limits (org freeze, blocklist, withdrawal allowlist, per-withdrawal
 * and rolling 24h withdrawal caps — see treasury-guard.ts) are evaluated
 * separately and BEFORE this threshold, so a parked request is never one the
 * guard would refuse anyway, and an approval is never a second, stricter gate
 * stacked on top of a refusal. The guard runs again when an approved request
 * executes, because the world may have changed while it waited.
 *
 * Stored per org as `settings.treasuryHitlUsdc` (decimal USDC string). The
 * name is historical; the meaning is "review above".
 */
import { parseUsdcToMicro } from "@policyvault/common";

/** $50 — the default when an org never set its own threshold. */
export const DEFAULT_TREASURY_APPROVAL_THRESHOLD_MICRO = 50_000_000n;

export type TreasuryThresholdOutcome = "allow" | "review";

/** Resolve an org's threshold in micro-USDC from its settings blob. */
export function treasuryApprovalThresholdMicro(
  settings: Record<string, unknown> | undefined | null,
): bigint {
  const raw = settings?.treasuryHitlUsdc;
  if (typeof raw === "string" || typeof raw === "number") {
    try {
      const micro = parseUsdcToMicro(String(raw).trim());
      if (micro >= 0n) return micro;
    } catch {
      /* unparsable setting — fall back to the default, never to "no review" */
    }
  }
  return DEFAULT_TREASURY_APPROVAL_THRESHOLD_MICRO;
}

/** Strictly above the threshold reviews; at or below it runs now. */
export function treasuryThresholdOutcome(
  amountMicro: bigint,
  thresholdMicro: bigint,
): TreasuryThresholdOutcome {
  return amountMicro > thresholdMicro ? "review" : "allow";
}
