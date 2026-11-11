/**
 * Shared error type for third-party vendor adapters (Prodigi, ScrapingAnt).
 *
 * Vendor adapters sit behind ABI's own payment boundary: the agent pays ABI
 * (x402, under its budget caps) and ABI calls the vendor with a key that never
 * leaves the server. Neither vendor speaks x402 natively, so these adapters are
 * plain authenticated HTTP clients. Errors never carry the vendor key.
 */
export type VendorName = "prodigi" | "scrapingant";

export type VendorErrorCode =
  | "not_configured"
  | "invalid_request"
  | "unauthorized"
  | "not_found"
  | "rate_limited"
  | "vendor_unavailable"
  | "timeout"
  | "bad_response";

export class VendorError extends Error {
  constructor(
    readonly vendor: VendorName,
    readonly code: VendorErrorCode,
    message: string,
    readonly status?: number,
    /** True when retrying the same request later could succeed. */
    readonly retryable = false,
  ) {
    super(message);
    this.name = "VendorError";
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Remove anything that looks like the configured key from a vendor message. */
export function redact(text: string, secret: string | undefined): string {
  const clipped = text.slice(0, 500);
  return secret ? clipped.split(secret).join("[redacted]") : clipped;
}

export async function timedFetch(
  vendor: VendorName,
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal, redirect: "error" });
  } catch {
    if (controller.signal.aborted)
      throw new VendorError(
        vendor,
        "timeout",
        `${vendor} did not answer in time.`,
        undefined,
        true,
      );
    throw new VendorError(
      vendor,
      "vendor_unavailable",
      `${vendor} could not be reached.`,
      undefined,
      true,
    );
  } finally {
    clearTimeout(timer);
  }
}
