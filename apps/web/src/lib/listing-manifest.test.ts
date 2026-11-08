import assert from "node:assert/strict";
import { test } from "node:test";
import { stringify } from "yaml";
import {
  listingDraft,
  draftManifest,
  serializeListing,
  parseListing,
  manifestDraft,
  listingPayload,
} from "./listing-manifest";

function fixture() {
  const d = listingDraft();
  Object.assign(d, {
    name: "Research API",
    description: "Searches public research sources.",
    category: "Research",
    priceUsdc: "0.10",
    stockLevel: "50",
    offerId: "offer_1",
  });
  d.extraAttributes = { vendorReference: "retained" };
  d.service = {
    logo: "https://example.com/logo.png",
    website: "https://example.com",
    docs: "https://example.com/docs",
    baseUrl: "https://example.com/v1",
    authentication: { type: "api_key_header", name: "X-API-Key" },
    endpoints: [
      {
        name: "Search",
        method: "POST",
        path: "/search",
        description: "Returns ranked research results.",
        resource: "customer_data",
        pricing: {
          model: "usage_based",
          amount: "0.01",
          currency: "USD",
          unit: "100 results",
          billingTerms: "USD 0.01 per 100 results; invoiced monthly.",
        },
      },
    ],
  };
  return d;
}
test("form to YAML to form preserves all service fields and exact checkout money", () => {
  const d = fixture(),
    m = parseListing(serializeListing(d));
  assert.equal(m.priceMicro, "100000");
  assert.equal(m.service?.endpoints[0].pricing.amount, "0.01");
  assert.deepEqual(manifestDraft(m), { ...d, priceUsdc: "0.1" });
  const saved = listingPayload(m);
  assert.equal(saved.attributes.vendorReference, "retained");
  assert.deepEqual(saved.attributes.service, d.service);
  assert.ok(!("schemaVersion" in saved));
});
test("YAML edits apply endpoint methods, auth and resource semantics", () => {
  const d = fixture();
  d.service.authentication = { type: "api_key_query", name: "api_key" };
  d.service.endpoints[0].method = "OPTIONS";
  d.service.endpoints[0].resource = "owned_resource";
  const m = parseListing(serializeListing(d));
  assert.equal(m.service?.authentication.name, "api_key");
  assert.equal(m.service?.endpoints[0].method, "OPTIONS");
  assert.equal(m.service?.endpoints[0].resource, "owned_resource");
});
test("YAML rejects secrets, duplicate keys, aliases and unknown schema versions", () => {
  const m = draftManifest(fixture());
  assert.throws(
    () =>
      parseListing(
        stringify({
          ...m,
          service: {
            ...m.service,
            authentication: { type: "bearer", name: "", token: "never-publish" },
          },
        }),
      ),
    /Unrecognized key/,
  );
  assert.throws(() => parseListing(serializeListing(fixture()) + "\nname: duplicate\n"), /unique/);
  assert.throws(() => parseListing("name: &x test\ndescription: *x"), /alias|Alias/i);
  assert.throws(() => parseListing(stringify({ ...m, schemaVersion: "unknown" })), /schemaVersion/);
});
test("invalid endpoint definitions cannot replace the valid form", () => {
  const d = fixture();
  d.service.endpoints.push({ ...d.service.endpoints[0] });
  assert.throws(() => parseListing(serializeListing(d)), /unique/);
  d.service.endpoints.pop();
  d.service.baseUrl = "https://user:secret@example.com/v1";
  assert.throws(() => parseListing(serializeListing(d)), /credentials/);
  d.service.baseUrl = "https://example.com/v1";
  d.service.endpoints[0].path = "/search?api_key=secret";
  assert.throws(() => parseListing(serializeListing(d)), /query strings/);
});
test("digital and physical manifests retain custom attributes without service credentials", () => {
  const d = fixture();
  d.kind = "physical";
  const m = parseListing(serializeListing(d));
  assert.equal(m.service, undefined);
  assert.equal(m.attributes.vendorReference, "retained");
  assert.equal(manifestDraft(m).kind, "physical");
});
