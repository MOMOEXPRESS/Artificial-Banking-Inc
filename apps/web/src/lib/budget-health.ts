/**
 * Small pure helpers for the overview's Budget health panel.
 */
import { summarizeFailures, type LoadFailure } from "./load-state";

/** Daily cap to show: `/org` first (fresh), then the policy; null if neither has loaded. */
export function budgetCapUsdc(
  orgDailyMax: string | number | null | undefined,
  policyDailyMax: string | number | null | undefined,
): string | null {
  for (const v of [orgDailyMax, policyDailyMax]) {
    if (v === null || v === undefined || v === "") continue;
    const n = Number(v);
    if (Number.isFinite(n)) return String(v);
  }
  return null;
}

/** "Couldn't refresh: org (HTTP 502). Showing figures from 21:04." */
export function budgetRefreshNote(
  p: { failures: LoadFailure[]; lastOkAt: number | null },
  fmtClock: (ms: number) => string = (ms) =>
    new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
): string {
  const what = summarizeFailures(p.failures);
  const since = p.lastOkAt ? ` Showing figures from ${fmtClock(p.lastOkAt)}.` : "";
  return `Couldn't refresh${what ? `: ${what}` : ""}.${since}`;
}
