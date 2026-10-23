/**
 * Response helpers for the console.
 *
 * Every poll used to do `fetch(...).then((r) => r.json())` and store the body
 * as if it were the success payload. A 429 / 5xx / proxy error body
 * (`{ error: { ... } }`) then replaced real state, and the first render that
 * dereferenced a nested field (`org.org.name`, `wallets.org.availableUsdc`)
 * threw into the error boundary. These helpers make "not a success payload"
 * an explicit `null` so callers keep their previous state instead.
 */

/** Parsed JSON for a 2xx response; `null` for any other status or a non-JSON body. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function okJson<T = any>(res: Response): Promise<T | null> {
  if (!res.ok) return null;
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Whether a failed `/v1/auth/me` check means the stored session is really gone.
 * Only an explicit 401 does; a rate limit, cold start or proxy error must not
 * sign the user out on reload.
 */
export function sessionRejected(status: number): boolean {
  return status === 401;
}

/** Plain-object check used before trusting a payload's nested fields. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
