import test from "node:test";
import assert from "node:assert/strict";
import {
  INTEGRATED_PROVIDERS,
  SCRAPINGANT_PLANS,
  creditCostUsd,
  findProvider,
  formatUsd,
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
