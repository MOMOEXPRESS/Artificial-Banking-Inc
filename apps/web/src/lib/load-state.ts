/**
 * Loading-state helpers for console views.
 *
 * Three views used to gate their whole lower half on "every request returned
 * 2xx": Insights/Activity (four analytics calls), Policies (the slow poll's
 * `/v1/guardian/policy`) and the shell itself (`/v1/guardian/org`). A single
 * 429, timeout or 5xx was turned into `null` by `okJson()` and silently
 * ignored, so the skeleton never went away and nothing said why. These helpers
 * make a failure observable: which path, which status, and when to give up
 * waiting and show the operator a Retry.
 */

/** Default ceiling for one console request before it is aborted. */
export const CONSOLE_FETCH_TIMEOUT_MS = 15_000;

/** A request that did not produce a success payload. */
export type LoadFailure = {
  path: string;
  /** HTTP status, or 0 for a network error / timeout. */
  status: number;
  /** Short machine-ish reason: "timeout", "network", "RATE_LIMITED", "HTTP 503"… */
  reason: string;
  at: number;
};

/**
 * Wrap `fetch` with an abort timeout. Respects a caller-supplied signal: if
 * either fires, the request is aborted. Rejects with an Error whose `name` is
 * "TimeoutError" when our timer fired.
 */
export async function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
  timeoutMs = CONSOLE_FETCH_TIMEOUT_MS,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMs);
  const outer = init.signal;
  const onOuterAbort = () => ctrl.abort();
  if (outer) {
    if (outer.aborted) ctrl.abort();
    else outer.addEventListener("abort", onOuterAbort, { once: true });
  }
  try {
    return await fetchImpl(input, { ...init, signal: ctrl.signal });
  } catch (e) {
    if (timedOut) {
      const err = new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s: ${input}`);
      err.name = "TimeoutError";
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener("abort", onOuterAbort);
  }
}

/** Describe a non-2xx response without consuming its body for the caller. */
export async function describeFailure(path: string, res: Response): Promise<LoadFailure> {
  let reason = `HTTP ${res.status}`;
  try {
    const body = (await res.clone().json()) as { error?: { code?: string } };
    if (body?.error?.code) reason = body.error.code;
  } catch {
    /* non-JSON error page */
  }
  return { path, status: res.status, reason, at: Date.now() };
}

/** Describe a thrown fetch (timeout or network). */
export function describeThrown(path: string, e: unknown): LoadFailure {
  const name = e instanceof Error ? e.name : "";
  return {
    path,
    status: 0,
    reason: name === "TimeoutError" ? "timeout" : name === "AbortError" ? "aborted" : "network",
    at: Date.now(),
  };
}

/** Strip query strings and the proxy prefix so logs and UI show a stable path. */
export function shortPath(path: string): string {
  const noQuery = path.split("?")[0];
  return noQuery.replace(/^.*\/abi-api(?=\/)/, "");
}

/** One-line operator-facing summary of failures, e.g. "burn (RATE_LIMITED), anomalies (timeout)". */
export function summarizeFailures(failures: LoadFailure[]): string {
  return failures
    .map((f) => `${shortPath(f.path).replace(/^\/v1\/guardian\//, "")} (${f.reason})`)
    .join(", ");
}

/**
 * Console logging for load failures — deliberately path + status only, never a
 * body, header or credential.
 */
export function logLoadFailure(view: string, f: LoadFailure): void {
  if (typeof console === "undefined") return;
  console.warn(`[abi:load] ${view} ${shortPath(f.path)} failed: ${f.reason} (status ${f.status})`);
}

/**
 * Should a gated view stop showing its skeleton and show an error instead?
 * Yes once it has failed `minFailures` times, or has been waiting longer than
 * `maxWaitMs` with at least one failure.
 */
export function shouldShowLoadError(
  state: { failures: number; startedAt: number; loaded: boolean },
  now = Date.now(),
  opts: { minFailures?: number; maxWaitMs?: number } = {},
): boolean {
  if (state.loaded) return false;
  const minFailures = opts.minFailures ?? 1;
  const maxWaitMs = opts.maxWaitMs ?? 10_000;
  if (state.failures >= minFailures) return true;
  return state.failures > 0 && now - state.startedAt > maxWaitMs;
}
