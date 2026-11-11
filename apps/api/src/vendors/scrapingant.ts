/**
 * ScrapingAnt web scraping adapter (API v2).
 *
 * Checked against docs.scrapingant.com on 2026-11-11:
 *  - endpoints: /v2/general (HTML), /v2/markdown (JSON { url, markdown }),
 *    /v2/extract (AI extraction, adds `extract_properties`).
 *  - auth: `x-api-key` header or query parameter; the header keeps the key
 *    out of URLs and logs.
 *  - `browser` defaults to true, `proxy_type` to datacenter, `timeout` is
 *    5-60 seconds. Every response carries `Ant-credits-cost`.
 *  - credit table (credits-cost page): plain request 1, headless without JS
 *    (return_page_source=true) 2, headless with JS 10; residential proxy 25,
 *    50 and 125; any Google domain on datacenter proxy 10. AI extraction adds
 *    ceil((markdown chars + output chars) / 30) on top of the request cost.
 *
 * Credits are what ScrapingAnt bills ABI. Turning them into a price for an
 * agent needs ABI's own price per credit, which is not set yet.
 */
import { VendorError, redact, timedFetch, type FetchLike } from "./vendor-error.js";

export const SCRAPINGANT_BASE_URL = "https://api.scrapingant.com/v2";

export type ScrapeEndpoint = "general" | "markdown" | "extract";
export type ScrapeOptions = {
  endpoint: ScrapeEndpoint;
  url: string;
  /** Headless browser; ScrapingAnt's default is true. */
  browser?: boolean;
  /** Browser without JS rendering (2 credits on datacenter instead of 10). */
  returnPageSource?: boolean;
  proxyType?: "datacenter" | "residential";
  proxyCountry?: string;
  /** Seconds, 5-60. */
  timeout?: number;
  /** Required for `extract`: e.g. "product title, price". */
  extractProperties?: string;
};

export type CreditEstimate = {
  /** Credits for the request settings (fixed by ScrapingAnt's table). */
  requestCredits: number;
  /** True for AI extraction, which adds a page-length-dependent amount. */
  variable: boolean;
};

const GOOGLE_HOST = /(^|\.)google\.[a-z.]+$/i;

function isGoogle(url: string): boolean {
  try {
    return GOOGLE_HOST.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** ScrapingAnt's published credit cost for one request's settings. */
export function estimateCredits(options: ScrapeOptions): CreditEstimate {
  const browser = options.browser ?? true;
  const residential = options.proxyType === "residential";
  let credits: number;
  if (!browser) credits = residential ? 25 : 1;
  else if (options.returnPageSource) credits = residential ? 50 : 2;
  else credits = residential ? 125 : 10;
  if (!residential && isGoogle(options.url)) credits = 10;
  return { requestCredits: credits, variable: options.endpoint === "extract" };
}

/** AI extractor total: ceil((markdown + output chars) / 30) + request cost. */
export function extractorCredits(
  markdownChars: number,
  outputChars: number,
  requestCredits: number,
): number {
  return Math.ceil((markdownChars + outputChars) / 30) + requestCredits;
}

function fail(message: string): never {
  throw new VendorError("scrapingant", "invalid_request", message, 400);
}

export function validateScrape(options: ScrapeOptions): ScrapeOptions {
  if (!["general", "markdown", "extract"].includes(options?.endpoint))
    fail("Choose general, markdown or extract.");
  let target: URL;
  try {
    target = new URL(options.url);
  } catch {
    fail("The page address is not a valid URL.");
  }
  if (target.protocol !== "https:" && target.protocol !== "http:")
    fail("Only http and https pages can be scraped.");
  if (options.timeout !== undefined && (options.timeout < 5 || options.timeout > 60))
    fail("Timeout must be between 5 and 60 seconds.");
  if (options.proxyCountry !== undefined && !/^[A-Za-z]{2}$/.test(options.proxyCountry))
    fail("Proxy country must be a two-letter code.");
  if (options.endpoint === "extract") {
    const p = options.extractProperties?.trim();
    if (!p) fail("AI extraction needs the properties to extract, e.g. 'title, price'.");
    if (p.length > 1000) fail("Keep the extraction properties under 1,000 characters.");
  }
  return options;
}

export type ScrapeResult = {
  status: number;
  /** Credits ScrapingAnt reports it charged (Ant-credits-cost header). */
  creditsCharged: number | null;
  /** The target site's own status code, when ScrapingAnt reports it. */
  pageStatus: number | null;
  contentType: string;
  body: string;
};

export function createScrapingAntClient(config: {
  apiKey?: string;
  fetch?: FetchLike;
  /** Extra milliseconds allowed beyond the vendor-side timeout. */
  graceMs?: number;
}) {
  const fetchImpl = config.fetch ?? fetch;
  return {
    configured: Boolean(config.apiKey),
    estimateCredits,

    async scrape(options: ScrapeOptions): Promise<ScrapeResult> {
      validateScrape(options);
      if (!config.apiKey)
        throw new VendorError(
          "scrapingant",
          "not_configured",
          "ScrapingAnt is not connected yet. Add its API key on the ABI server.",
        );
      const params = new URLSearchParams({ url: options.url });
      if (options.browser !== undefined) params.set("browser", String(options.browser));
      if (options.returnPageSource) params.set("return_page_source", "true");
      if (options.proxyType) params.set("proxy_type", options.proxyType);
      if (options.proxyCountry) params.set("proxy_country", options.proxyCountry.toUpperCase());
      if (options.timeout) params.set("timeout", String(options.timeout));
      if (options.endpoint === "extract")
        params.set("extract_properties", options.extractProperties!.trim());
      const vendorTimeout = (options.timeout ?? 60) * 1000;
      const response = await timedFetch(
        "scrapingant",
        fetchImpl,
        `${SCRAPINGANT_BASE_URL}/${options.endpoint}?${params}`,
        { method: "GET", headers: { "x-api-key": config.apiKey } },
        vendorTimeout + (config.graceMs ?? 10_000),
      );
      const body = await response.text();
      if (!response.ok) {
        let detail = `ScrapingAnt returned ${response.status}.`;
        try {
          const parsed = JSON.parse(body) as { detail?: unknown };
          if (typeof parsed.detail === "string") detail = parsed.detail;
        } catch {
          /* plain-text error */
        }
        const s = response.status;
        // Per docs.scrapingant.com/errors: 403 token/credits/IP whitelist,
        // 404 unreachable site or worker timeout, 409 concurrency limit,
        // 422 missing token or invalid parameter, 423 target-site detection,
        // 500 server or extraction failure.
        const code =
          s === 403
            ? "unauthorized"
            : s === 404
              ? "not_found"
              : s === 409 || s === 429
                ? "rate_limited"
                : s >= 500 || s === 423
                  ? "vendor_unavailable"
                  : "invalid_request";
        throw new VendorError(
          "scrapingant",
          code,
          redact(detail, config.apiKey),
          s,
          s === 409 || s === 429 || s >= 500,
        );
      }
      const credits = Number(response.headers.get("Ant-credits-cost"));
      const page = Number(response.headers.get("Ant-page-status-code"));
      return {
        status: response.status,
        creditsCharged:
          Number.isFinite(credits) && response.headers.has("Ant-credits-cost") ? credits : null,
        pageStatus:
          Number.isFinite(page) && response.headers.has("Ant-page-status-code") ? page : null,
        contentType: response.headers.get("content-type") ?? "",
        body,
      };
    },
  };
}
