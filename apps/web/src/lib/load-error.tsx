"use client";

import { Button } from "@/components/ui/button";
import { Icon } from "./ui";
import { summarizeFailures, type LoadFailure } from "./load-state";

/**
 * Shown in place of a skeleton that would otherwise spin forever. Says what
 * failed (path + reason, never a body) and offers Retry. Polling keeps going
 * underneath, so the view recovers on its own when the API answers again.
 */
export function LoadError({
  title,
  failures,
  onRetry,
  retrying,
  compact,
  testId,
}: {
  title: string;
  failures: LoadFailure[];
  onRetry: () => void;
  retrying?: boolean;
  compact?: boolean;
  testId?: string;
}) {
  const what = summarizeFailures(failures);
  const rateLimited = failures.some((f) => f.status === 429 || f.reason === "RATE_LIMITED");
  const timedOut = failures.some((f) => f.reason === "timeout");
  const hint = rateLimited
    ? "The API is rate-limiting this browser. It retries automatically; Retry now if you just waited."
    : timedOut
      ? "The API took too long to answer (cold start or a slow chain read). Retry usually works."
      : "The API did not return this data. It keeps retrying in the background.";
  return (
    <div
      className={`card load-error ${compact ? "compact" : ""}`}
      role="alert"
      data-testid={testId ?? "load-error"}
    >
      <div className="load-error-body">
        <span className="load-error-icon" aria-hidden>
          <Icon name="alert" size={16} />
        </span>
        <div>
          <b>{title}</b>
          <p>{hint}</p>
          {what && <p className="faint mono load-error-what">Failed: {what}</p>}
        </div>
        <Button size="sm" variant="secondary" disabled={retrying} onClick={onRetry}>
          {retrying ? "Retrying…" : "Retry"}
        </Button>
      </div>
    </div>
  );
}
