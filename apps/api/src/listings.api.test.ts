/**
 * Marketplace products spike: create → read round-trip (all fields including
 * images + attributes JSON), validation rejects bad input, cross-org reads
 * are refused. Mock rail only — no chain, no spend.
 */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "pv-listings-"));
process.env.POLICYVAULT_DB = join(dir, "listings.db");
process.env.ABI_KEY_PEPPER = "test-pepper";
process.env.ABI_NO_LISTEN = "1";
process.env.POLICYVAULT_MOCK_TRANSFER = "1";
process.env.ABI_CHAT_LLM = "0";
process.env.ABI_CHAT_AGENT = "0";
process.env.POLICYVAULT_ALLOW_BOOTSTRAP = "0";

const { store } = await import("./store.js");
const { app } = await import("./index.js");

let base = "";
let server: ReturnType<typeof app.listen>;
before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server?.close();
  rmSync(dir, { recursive: true, force: true });
});

type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
async function call(path: string, key: string, body?: unknown, method = "POST") {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  let parsed: J = {};
  try {
    parsed = (await res.json()) as J;
  } catch {
    parsed = {};
  }
  return { status: res.status, body: parsed };
}

const sample = {
  name: "Trail daypack 28L",
  description: "Lightweight hiking pack with rain cover",
  category: "outdoor",
  priceMicro: "45990000",
  currency: "USDC",
  stockLevel: 12,
  vendorId: "vendor_alpine_co",
  images: ["https://cdn.example.com/packs/28l-front.jpg", "https://cdn.example.com/packs/28l-side.jpg"],
  attributes: {
    size: "28L",
    region: "EU",
    deliveryTime: "3-5 days",
    color: "forest-green",
  },
};

describe("POST /v1/guardian/products + GET by id", () => {
  it("creates a product and reads back every field including images and attributes", async () => {
    const org = store.createOrg("Listings Spike Co", 0n);
    const created = await call("/v1/guardian/products", org.guardianKey, sample);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const product = created.body.product;
    assert.ok(product.id && String(product.id).startsWith("prod_"));
    assert.equal(product.orgId, org.id);
    assert.equal(product.name, sample.name);
    assert.equal(product.description, sample.description);
    assert.equal(product.category, sample.category);
    assert.equal(product.priceMicro, sample.priceMicro);
    assert.equal(product.currency, "USDC");
    assert.equal(product.stockLevel, 12);
    assert.equal(product.vendorId, sample.vendorId);
    assert.deepEqual(product.images, sample.images);
    assert.deepEqual(product.attributes, sample.attributes);
    assert.ok(product.createdAt);
    assert.ok(product.updatedAt);

    const got = await call(`/v1/guardian/products/${product.id}`, org.guardianKey, undefined, "GET");
    assert.equal(got.status, 200, JSON.stringify(got.body));
    assert.deepEqual(got.body.product, product);
  });

  it("rejects invalid create payloads", async () => {
    const org = store.createOrg("Listings Validation Co", 0n);
    const key = org.guardianKey;

    const missingName = await call("/v1/guardian/products", key, { ...sample, name: "" });
    assert.equal(missingName.status, 400);
    assert.equal(missingName.body.error?.code, "VALIDATION_ERROR");

    const badPrice = await call("/v1/guardian/products", key, { ...sample, priceMicro: "12.5" });
    assert.equal(badPrice.status, 400);
    assert.equal(badPrice.body.error?.code, "VALIDATION_ERROR");

    const badImage = await call("/v1/guardian/products", key, {
      ...sample,
      images: ["not-a-url"],
    });
    assert.equal(badImage.status, 400);
    assert.equal(badImage.body.error?.code, "VALIDATION_ERROR");

    const negStock = await call("/v1/guardian/products", key, { ...sample, stockLevel: -1 });
    assert.equal(negStock.status, 400);
    assert.equal(negStock.body.error?.code, "VALIDATION_ERROR");

    const noAuth = await fetch(`${base}/v1/guardian/products`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(sample),
    });
    assert.equal(noAuth.status, 401);
  });

  it("refuses cross-org reads (404, no leak)", async () => {
    const a = store.createOrg("Vendor A", 0n);
    const b = store.createOrg("Vendor B", 0n);
    const created = await call("/v1/guardian/products", a.guardianKey, sample);
    assert.equal(created.status, 201);
    const id = created.body.product.id as string;

    const cross = await call(`/v1/guardian/products/${id}`, b.guardianKey, undefined, "GET");
    assert.equal(cross.status, 404);
    assert.equal(cross.body.error?.code, "NOT_FOUND");
    assert.equal(cross.body.product, undefined);

    const missing = await call(`/v1/guardian/products/prod_doesnotexist`, a.guardianKey, undefined, "GET");
    assert.equal(missing.status, 404);
  });
});
