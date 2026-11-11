import assert from "node:assert/strict";
import { test } from "node:test";
import { createProdigiClient, prodigiEnvironment, validateQuoteRequest } from "./prodigi.js";
import { createScrapingAntClient, estimateCredits, extractorCredits } from "./scrapingant.js";
import { VendorError } from "./vendor-error.js";

type Call = { url: string; init?: RequestInit };
function fakeFetch(responses: Response[]) {
  const calls: Call[] = [];
  const impl = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    return next;
  };
  return { calls, impl };
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

const address = {
  line1: "1 Rue Example",
  townOrCity: "Angers",
  postalOrZipCode: "49000",
  countryCode: "FR",
};
const money = (amount: string, currency = "EUR") => ({ amount, currency });

test("Prodigi environment comes from the key prefix", () => {
  assert.equal(prodigiEnvironment("sandbox_abc"), "sandbox");
  assert.equal(prodigiEnvironment("live_abc"), "live");
  assert.equal(prodigiEnvironment("test_abc"), null);
  assert.equal(prodigiEnvironment(undefined), null);
});

test("Prodigi without a key refuses before any network call", async () => {
  const f = fakeFetch([]);
  const client = createProdigiClient({ fetch: f.impl });
  assert.equal(client.configured, false);
  await assert.rejects(
    client.quoteOrder({
      items: [{ catalogueVariantId: "v1", quantity: 1 }],
      shippingAddress: address,
    }),
    (e: unknown) => e instanceof VendorError && e.code === "not_configured",
  );
  assert.equal(f.calls.length, 0);
});

test("Prodigi quote validation follows the v5 schema", () => {
  const bad = (patch: object) => () =>
    validateQuoteRequest({
      items: [{ catalogueVariantId: "v1", quantity: 1 }],
      shippingAddress: address,
      ...patch,
    });
  assert.throws(bad({ items: [] }), /at least one item/);
  assert.throws(
    bad({ items: [{ catalogueVariantId: "bad id!", quantity: 1 }] }),
    /catalogueVariantId/,
  );
  assert.throws(bad({ items: [{ catalogueVariantId: "v1", quantity: 0 }] }), /quantity/);
  assert.throws(bad({ shippingAddress: { ...address, countryCode: "France" } }), /two-letter/);
  assert.throws(bad({ shippingAddress: { ...address, line1: "x".repeat(101) } }), /100/);
  assert.doesNotThrow(bad({}));
});

test("Prodigi quote sends the key in X-API-Key and returns every amount", async () => {
  const f = fakeFetch([
    json({
      data: {
        items: money("3.00"),
        shipping: money("4.50"),
        tax: money("1.50"),
        total: money("9.00"),
        shippingOptions: [],
        lineItems: [],
      },
    }),
  ]);
  const client = createProdigiClient({ apiKey: "sandbox_secret", fetch: f.impl });
  const quote = await client.quoteOrder({
    items: [{ catalogueVariantId: "v1", quantity: 2, attributes: { wrap: "White" } }],
    shippingAddress: address,
  });
  assert.equal(quote.total.amount, "9.00");
  assert.equal(f.calls[0].url, "https://api.prodigi.com/v5/quotes/order");
  assert.equal(f.calls[0].init?.method, "POST");
  assert.equal((f.calls[0].init?.headers as Record<string, string>)["X-API-Key"], "sandbox_secret");
  assert.match(String(f.calls[0].init?.body), /"wrap":"White"/);
});

test("Prodigi resolves a GLOBAL SKU to its catalogue variant id", async () => {
  const f = fakeFetch([
    json({
      data: [
        { id: "other", sku: "GLOBAL-FAP-11X14-X" },
        { id: "var_1", sku: "GLOBAL-FAP-11X14" },
      ],
    }),
  ]);
  const client = createProdigiClient({ apiKey: "live_k", fetch: f.impl });
  const variant = await client.resolveVariantBySku("global-fap-11x14");
  assert.equal(variant.id, "var_1");
  assert.match(f.calls[0].url, /\/catalogue\/search\?q=global-fap-11x14/);
});

test("Prodigi errors are mapped and never echo the key", async () => {
  const f = fakeFetch([json({ message: "bad key live_k" }, 401), json({ message: "down" }, 503)]);
  const client = createProdigiClient({ apiKey: "live_k", fetch: f.impl });
  const req = { items: [{ catalogueVariantId: "v1", quantity: 1 }], shippingAddress: address };
  await assert.rejects(client.quoteOrder(req), (e: unknown) => {
    assert.ok(e instanceof VendorError);
    assert.equal(e.code, "unauthorized");
    assert.equal(e.retryable, false);
    assert.doesNotMatch(e.message, /live_k/);
    return true;
  });
  await assert.rejects(
    client.quoteOrder(req),
    (e: unknown) => e instanceof VendorError && e.code === "vendor_unavailable" && e.retryable,
  );
});

test("Prodigi rejects a quote with malformed amounts", async () => {
  const f = fakeFetch([
    json({ data: { items: money("3"), total: { amount: "lots", currency: "EUR" } } }),
  ]);
  const client = createProdigiClient({ apiKey: "live_k", fetch: f.impl });
  await assert.rejects(
    client.quoteOrder({
      items: [{ catalogueVariantId: "v1", quantity: 1 }],
      shippingAddress: address,
    }),
    (e: unknown) => e instanceof VendorError && e.code === "bad_response",
  );
});

test("ScrapingAnt credit table matches the published costs", () => {
  const u = "https://example.com";
  const c = (o: object) => estimateCredits({ endpoint: "general", url: u, ...o }).requestCredits;
  assert.equal(c({ browser: false }), 1);
  assert.equal(c({ browser: true, returnPageSource: true }), 2);
  assert.equal(c({}), 10); // browser defaults to true
  assert.equal(c({ browser: false, proxyType: "residential" }), 25);
  assert.equal(c({ returnPageSource: true, proxyType: "residential" }), 50);
  assert.equal(c({ proxyType: "residential" }), 125);
  assert.equal(
    estimateCredits({
      endpoint: "general",
      url: "https://www.google.com/search?q=x",
      browser: false,
    }).requestCredits,
    10,
  );
  assert.equal(estimateCredits({ endpoint: "extract", url: u }).variable, true);
  assert.equal(extractorCredits(2990, 10, 10), 110);
  assert.equal(extractorCredits(31, 0, 1), 3);
});

test("ScrapingAnt validates input before calling", async () => {
  const f = fakeFetch([]);
  const client = createScrapingAntClient({ apiKey: "k", fetch: f.impl });
  await assert.rejects(client.scrape({ endpoint: "general", url: "ftp://x" }), /http and https/);
  await assert.rejects(
    client.scrape({ endpoint: "general", url: "https://x.com", timeout: 90 }),
    /5 and 60/,
  );
  await assert.rejects(client.scrape({ endpoint: "extract", url: "https://x.com" }), /properties/);
  assert.equal(f.calls.length, 0);
  const none = createScrapingAntClient({ fetch: f.impl });
  await assert.rejects(
    none.scrape({ endpoint: "general", url: "https://x.com" }),
    (e: unknown) => e instanceof VendorError && e.code === "not_configured",
  );
});

test("ScrapingAnt sends the key as a header and reads the credit headers", async () => {
  const f = fakeFetch([
    new Response("<html></html>", {
      status: 200,
      headers: {
        "Ant-credits-cost": "10",
        "Ant-page-status-code": "200",
        "content-type": "text/html",
      },
    }),
  ]);
  const client = createScrapingAntClient({ apiKey: "secret", fetch: f.impl });
  const result = await client.scrape({
    endpoint: "extract",
    url: "https://example.com/p",
    extractProperties: "title, price",
    proxyCountry: "fr",
  });
  assert.equal(result.creditsCharged, 10);
  assert.equal(result.pageStatus, 200);
  const url = new URL(f.calls[0].url);
  assert.equal(url.pathname, "/v2/extract");
  assert.equal(url.searchParams.get("extract_properties"), "title, price");
  assert.equal(url.searchParams.get("proxy_country"), "FR");
  assert.equal(url.searchParams.has("x-api-key"), false);
  assert.equal((f.calls[0].init?.headers as Record<string, string>)["x-api-key"], "secret");
});

test("ScrapingAnt errors follow the documented status codes", async () => {
  const f = fakeFetch([
    json({ detail: "API token is wrong secret" }, 403),
    json({ detail: "Free user concurrency limit" }, 409),
    json({ detail: "Wrong host part of url" }, 422),
  ]);
  const client = createScrapingAntClient({ apiKey: "secret", fetch: f.impl });
  const run = () => client.scrape({ endpoint: "general", url: "https://example.com" });
  await assert.rejects(run(), (e: unknown) => {
    assert.ok(e instanceof VendorError);
    assert.equal(e.code, "unauthorized");
    assert.doesNotMatch(e.message, /secret/);
    return true;
  });
  await assert.rejects(
    run(),
    (e: unknown) => e instanceof VendorError && e.code === "rate_limited" && e.retryable,
  );
  await assert.rejects(
    run(),
    (e: unknown) => e instanceof VendorError && e.code === "invalid_request",
  );
});
