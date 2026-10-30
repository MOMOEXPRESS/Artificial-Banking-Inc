/**
 * What the Insights page should say about its four data parts.
 * Pure so the wording and thresholds are unit-tested (see insights-load.test.ts).
 */
import { DEFAULT_BACKOFF, type PollState } from "./bounded-poll";
import type { LoadFailure } from "./load-state";

export const INSIGHT_PARTS = ["vendors", "burn", "anomalies", "economics"] as const;
export type InsightPart = (typeof INSIGHT_PARTS)[number];

export const INSIGHT_LABELS: Record<InsightPart, string> = {
  vendors: "Vendors",
  burn: "Forecast",
  anomalies: "Anomalies",
  economics: "P&L",
};

export type InsightsLoadView = {
  show: boolean;
  /** At least one part used up its automatic retries. */
  gaveUp: boolean;
  failures: LoadFailure[];
  hint: string;
};

const list = (labels: string[]) =>
  labels.length <= 1
    ? (labels[0] ?? "")
    : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;

/**
 * A single failed request is retried quietly (2 s later); the banner appears
 * from the second consecutive failure, or as soon as a part has given up.
 */
export function insightsLoadView(
  parts: Partial<Record<InsightPart, PollState | undefined>>,
  now = Date.now(),
  maxRetries = DEFAULT_BACKOFF.maxRetries,
): InsightsLoadView {
  const failing = INSIGHT_PARTS.filter((p) => {
    const st = parts[p];
    if (!st) return false;
    return st.status === "failed" || (st.status === "retrying" && st.failures >= 2);
  });
  const failures = failing.flatMap((p) => (parts[p]?.lastFailure ? [parts[p]!.lastFailure!] : []));
  const gaveUpParts = failing.filter((p) => parts[p]?.status === "failed");
  const retryingParts = failing.filter((p) => parts[p]?.status === "retrying");
  const rateLimited = failures.some((f) => f.status === 429 || f.reason === "RATE_LIMITED");
  const anyOk = INSIGHT_PARTS.some((p) => parts[p]?.lastOkAt);

  let hint = "";
  if (gaveUpParts.length) {
    hint =
      `${list(gaveUpParts.map((p) => INSIGHT_LABELS[p]))} didn't load after ${maxRetries + 1} attempts, ` +
      "so automatic retries have stopped." +
      (anyOk ? " Everything else on this page is current." : "") +
      (rateLimited ? " The API was rate-limiting this browser." : "") +
      " Press Retry to try again.";
  } else if (retryingParts.length) {
    const next = Math.min(
      ...retryingParts.map((p) => parts[p]?.nextAt ?? now).map((t) => Math.max(0, t - now)),
    );
    const secs = Math.max(1, Math.round(next / 1000));
    hint =
      `${list(retryingParts.map((p) => INSIGHT_LABELS[p]))} didn't answer. ` +
      `Retrying automatically in about ${secs}s` +
      (rateLimited ? " (the API is rate-limiting this browser)." : ".");
  }
  return { show: failing.length > 0, gaveUp: gaveUpParts.length > 0, failures, hint };
}
