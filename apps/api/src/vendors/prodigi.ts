/**
 * Prodigi print-on-demand adapter (API v5, https://api.prodigi.com/v5).
 *
 * Checked against Prodigi's published OpenAPI spec
 * (https://www.prodigi.com/print-api/docs/openapi.yml) on 2026-11-11:
 *  - auth: `X-API-Key` header; `sandbox_` keys place test orders with no
 *    fulfilment or order charges, `live_` keys are production. Same base URL.
 *  - quotes take `catalogueVariantId` (not the GLOBAL-* SKU), so a SKU is
 *    resolved through `GET /catalogue/search` first.
 *  - `POST /quotes/order` returns items, shipping, tax and total for one
 *    shipping address, each as { amount: "12.34", currency: "GBP" }.
 *
 * Deliberately read-only: there is no order creation here. Placing a print
 * order spends ABI's money with Prodigi, so it stays out until ABI's retail
 * pricing and the paid checkout path for physical goods are agreed.
 */
import { VendorError, redact, timedFetch, type FetchLike } from "./vendor-error.js";

export const PRODIGI_BASE_URL = "https://api.prodigi.com/v5";

export type ProdigiMoney = { amount: string; currency: string };
export type ProdigiAddress = {
  line1: string;
  line2?: string;
  townOrCity: string;
  stateOrCounty?: string;
  postalOrZipCode: string;
  countryCode: string;
};
export type ProdigiQuoteItem = {
  catalogueVariantId: string;
  quantity: number;
  /** Product options such as a canvas edge (`wrap`). Values are strings. */
  attributes?: Record<string, string>;
};
export type ProdigiQuoteRequest = {
  items: ProdigiQuoteItem[];
  shippingAddress: ProdigiAddress;
  shippingMethod?: string;
  currencyCode?: string;
};
export type ProdigiQuote = {
  items: ProdigiMoney;
  shipping: ProdigiMoney;
  tax: ProdigiMoney;
  total: ProdigiMoney;
  shippingOptions: unknown[];
  lineItems: unknown[];
};
export type ProdigiVariant = {
  id: string;
  sku: string;
  catalogueProductId?: string;
  name?: string;
  attributes?: unknown;
};

export type ProdigiConfig = {
  apiKey?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
};

const VARIANT_ID = /^[A-Za-z0-9~_-]+$/;
const COUNTRY = /^[A-Z]{2}$/;
const MONEY = /^-?\d+(\.\d{1,2})?$/;

export function prodigiEnvironment(apiKey: string | undefined): "sandbox" | "live" | null {
  if (!apiKey) return null;
  if (apiKey.startsWith("sandbox_")) return "sandbox";
  if (apiKey.startsWith("live_")) return "live";
  return null;
}

function fail(message: string): never {
  throw new VendorError("prodigi", "invalid_request", message, 400);
}

function checkLength(label: string, value: string | undefined, max: number, required: boolean) {
  if (value === undefined || value === "") {
    if (required) fail(`${label} is required.`);
    return;
  }
  if (typeof value !== "string" || value.length > max)
    fail(`${label} must be at most ${max} characters.`);
}

/** Validates a quote request against the v5 schema before it leaves ABI. */
export function validateQuoteRequest(request: ProdigiQuoteRequest): ProdigiQuoteRequest {
  if (!Array.isArray(request?.items) || request.items.length === 0)
    fail("A quote needs at least one item.");
  for (const item of request.items) {
    if (typeof item.catalogueVariantId !== "string" || !VARIANT_ID.test(item.catalogueVariantId))
      fail("Each item needs a valid catalogueVariantId.");
    if (!Number.isInteger(item.quantity) || item.quantity < 1)
      fail("Each item quantity must be a whole number of at least 1.");
    if (item.attributes)
      for (const [key, value] of Object.entries(item.attributes))
        if (typeof value !== "string") fail(`Option ${key} must be text.`);
  }
  const a = request.shippingAddress;
  if (!a) fail("A quote needs a shipping address.");
  checkLength("Address line 1", a.line1, 100, true);
  checkLength("Address line 2", a.line2, 100, false);
  checkLength("Town or city", a.townOrCity, 50, true);
  checkLength("State or county", a.stateOrCounty, 50, false);
  checkLength("Postal code", a.postalOrZipCode, 20, true);
  if (!COUNTRY.test(a.countryCode ?? "")) fail("Country must be a two-letter code such as FR.");
  return request;
}

function isMoney(value: unknown): value is ProdigiMoney {
  const v = value as ProdigiMoney;
  return (
    !!v && typeof v.amount === "string" && MONEY.test(v.amount) && /^[A-Z]{3}$/.test(v.currency)
  );
}

export function createProdigiClient(config: ProdigiConfig) {
  const fetchImpl = config.fetch ?? fetch;
  const timeoutMs = config.timeoutMs ?? 15_000;
  const environment = prodigiEnvironment(config.apiKey);

  async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!config.apiKey || !environment)
      throw new VendorError(
        "prodigi",
        "not_configured",
        "Prodigi is not connected yet. Add a sandbox_ or live_ API key on the ABI server.",
      );
    const response = await timedFetch(
      "prodigi",
      fetchImpl,
      `${PRODIGI_BASE_URL}${path}`,
      {
        ...init,
        headers: {
          Accept: "application/json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          "X-API-Key": config.apiKey,
        },
      },
      timeoutMs,
    );
    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (!response.ok) {
      const message = redact(
        String(
          (body as { message?: unknown } | null)?.message ?? `Prodigi returned ${response.status}.`,
        ),
        config.apiKey,
      );
      const s = response.status;
      const code =
        s === 401 || s === 403
          ? "unauthorized"
          : s === 404
            ? "not_found"
            : s === 429
              ? "rate_limited"
              : s >= 500
                ? "vendor_unavailable"
                : "invalid_request";
      throw new VendorError("prodigi", code, message, s, s === 429 || s >= 500);
    }
    if (body === null)
      throw new VendorError(
        "prodigi",
        "bad_response",
        "Prodigi sent an unreadable answer.",
        response.status,
      );
    return body as T;
  }

  return {
    environment,
    configured: environment !== null,

    /** Finds the catalogue variant for a GLOBAL-* SKU (quotes need its id). */
    async resolveVariantBySku(sku: string): Promise<ProdigiVariant> {
      if (!/^[A-Z0-9-]{3,60}$/i.test(sku)) fail("That is not a valid Prodigi SKU.");
      const result = await call<{ data?: unknown[] }>(
        `/catalogue/search?q=${encodeURIComponent(sku)}&limit=20`,
      );
      const wanted = sku.toUpperCase();
      const match = (result.data ?? []).find(
        (row) =>
          typeof (row as ProdigiVariant)?.sku === "string" &&
          (row as ProdigiVariant).sku.toUpperCase() === wanted &&
          typeof (row as ProdigiVariant).id === "string",
      ) as ProdigiVariant | undefined;
      if (!match)
        throw new VendorError(
          "prodigi",
          "not_found",
          `Prodigi has no variant with SKU ${sku}.`,
          404,
        );
      return match;
    },

    /**
     * Exact price for one address: items, shipping, tax and total, in the
     * currency Prodigi returns. This is Prodigi's charge to ABI, not a retail
     * price; ABI's own price has to be set on top before an agent is charged.
     */
    async quoteOrder(request: ProdigiQuoteRequest): Promise<ProdigiQuote> {
      validateQuoteRequest(request);
      const result = await call<{ data?: Partial<ProdigiQuote> }>("/quotes/order", {
        method: "POST",
        body: JSON.stringify(request),
      });
      const q = result.data;
      if (!q || !isMoney(q.items) || !isMoney(q.shipping) || !isMoney(q.tax) || !isMoney(q.total))
        throw new VendorError("prodigi", "bad_response", "Prodigi's quote was missing amounts.");
      return {
        items: q.items,
        shipping: q.shipping,
        tax: q.tax,
        total: q.total,
        shippingOptions: Array.isArray(q.shippingOptions) ? q.shippingOptions : [],
        lineItems: Array.isArray(q.lineItems) ? q.lineItems : [],
      };
    },
  };
}
