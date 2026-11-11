import test from "node:test";
import assert from "node:assert/strict";
import {
  INTEGRATED_LISTINGS,
  INTEGRATED_PROVIDERS,
  SCRAPINGANT_PLANS,
  creditCostUsd,
  findProvider,
  formatUsd,
  matchListings,
  matchProviders,
} from "./vendor-directory-data";

test("only the two real integrated vendors are listed", () => {
  assert.deepEqual(
    INTEGRATED_PROVIDERS.map((p) => p.slug),
    ["prodigi", "scrapingant"],
  );
  for (const p of INTEGRATED_PROVIDERS) {
    assert.ok(p.actions.length > 0);
    assert.ok(p.sources.every((s) => s.url.startsWith("https://")));
    assert.equal(p.status.label, "Browse only");
  }
});

test("ScrapingAnt dollar figures are labelled estimates from the plan math", () => {
  const [enthusiast] = SCRAPINGANT_PLANS;
  assert.equal(creditCostUsd(10, enthusiast), 0.0019);
  assert.equal(formatUsd(creditCostUsd(1, enthusiast)), "$0.00019");
  assert.equal(formatUsd(creditCostUsd(10, enthusiast)), "$0.0019");
  assert.equal(formatUsd(creditCostUsd(10, SCRAPINGANT_PLANS[3])), "$0.00075");
  const sa = findProvider("scrapingant")!;
  for (const a of sa.actions.filter((a) => /^\d+ credits?$/.test(a.price)))
    assert.match(a.priceDetail, /Estimated vendor cost .* Not an ABI price\./);
});

test("Prodigi prices are 'from' prices before tax and shipping", () => {
  const prodigi = findProvider("prodigi")!;
  const products = prodigi.actions.filter((a) => a.reference.startsWith("SKU"));
  assert.deepEqual(
    products.map((a) => a.price),
    ["From €3.00", "From £3.00", "From £14.00"],
  );
  assert.ok(products.every((a) => a.priceDetail.startsWith("Before tax and shipping")));
});

test("every action has a short price for the action list", () => {
  for (const p of INTEGRATED_PROVIDERS)
    for (const a of p.actions) assert.ok(a.unitPrice.length > 0 && a.unitPrice.length <= 24);
  const sa = findProvider("scrapingant")!;
  assert.equal(sa.actionNoun, "actions");
  const fetchPage = sa.actions.find((a) => a.id === "fetch-page")!;
  assert.equal(fetchPage.unitPrice, "1 credit/call");
  assert.equal(fetchPage.unitNote, "≈ $0.00019");
  const render = sa.actions.find((a) => a.id === "render-page")!;
  assert.equal(render.unitPrice, "10 credits/call");
  assert.equal(render.unitNote, "≈ $0.0019");
});

test("catalog search and kind tabs filter providers", () => {
  assert.deepEqual(
    matchProviders("", "physical").map((p) => p.slug),
    ["prodigi"],
  );
  assert.deepEqual(
    matchProviders("", "service").map((p) => p.slug),
    ["scrapingant"],
  );
  assert.deepEqual(matchProviders("", "digital"), []);
  assert.deepEqual(
    matchProviders("canvas", "").map((p) => p.slug),
    ["prodigi"],
  );
  assert.deepEqual(
    matchProviders("lead scraping", "").map((p) => p.slug),
    ["scrapingant"],
  );
  assert.equal(matchProviders("", "").length, 2);
});

test("every vendor product and action is one listing, with its provider", () => {
  const counts = Object.fromEntries(INTEGRATED_PROVIDERS.map((p) => [p.slug, p.actions.length]));
  assert.deepEqual(counts, { prodigi: 4, scrapingant: 6 });
  assert.equal(INTEGRATED_LISTINGS.length, 10);
  for (const { provider, action } of INTEGRATED_LISTINGS) {
    assert.ok(provider.actions.includes(action));
    assert.ok(action.listingTitle.trim().length > 3, action.id);
    assert.ok(action.unitPrice.trim().length > 0, action.id);
  }
  const titles = INTEGRATED_LISTINGS.map((l) => l.action.listingTitle);
  assert.equal(new Set(titles).size, titles.length);
});

test("listings follow the catalog search and kind tab", () => {
  assert.equal(matchListings("", "").length, 10);
  assert.equal(matchListings("prodigi", "").length, 4);
  assert.equal(matchListings("", "service").length, 6);
  assert.equal(matchListings("", "physical").length, 4);
  assert.deepEqual(
    matchListings("markdown", "").map((l) => l.action.id),
    ["page-markdown"],
  );
  assert.equal(matchListings("no such thing", "").length, 0);
});
