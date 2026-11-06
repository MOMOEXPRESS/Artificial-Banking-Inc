/**
 * M0: pin products-spike tenant behaviour before marketplace evolution.
 * - Another org cannot read a product via store.getProduct.
 * - Spike rows are owned by the creating org; vendor_id is opaque text.
 * - marketplaceDb() sees the same products table the store uses.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "pv-mkt-iso-"));
process.env.POLICYVAULT_DB = join(dir, "iso.db");

const { store, marketplaceDb } = await import("../store.js");

after(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

let alphaOrgId = "";
let betaOrgId = "";
let productId = "";

before(() => {
  const alpha = store.createOrg("Market Iso Alpha", 0n);
  const beta = store.createOrg("Market Iso Beta", 0n);
  alphaOrgId = alpha.id;
  betaOrgId = beta.id;
  const product = store.createProduct({
    orgId: alpha.id,
    name: "Isolation probe",
    description: "must not leak",
    category: "other",
    priceMicro: "1000000",
    currency: "USDC",
    stockLevel: 1,
    vendorId: "vendor_free_text",
    images: [],
    attributes: { size: "1" },
  });
  productId = product.id;
});

describe("products spike isolation (M0 pin)", () => {
  it("getProduct returns the row for the owning org", () => {
    const row = store.getProduct(alphaOrgId, productId);
    assert.ok(row);
    assert.equal(row.orgId, alphaOrgId);
    assert.equal(row.vendorId, "vendor_free_text");
  });

  it("getProduct returns undefined for another org (no leak)", () => {
    assert.equal(store.getProduct(betaOrgId, productId), undefined);
  });

  it("marketplaceDb can read the same row by id+org_id", () => {
    const db = marketplaceDb();
    const row = db
      .prepare("SELECT id, org_id, vendor_id, name FROM products WHERE id = ? AND org_id = ?")
      .get(productId, alphaOrgId) as
      { id: string; org_id: string; vendor_id: string; name: string } | undefined;
    assert.ok(row);
    assert.equal(row.org_id, alphaOrgId);
    const other = db
      .prepare("SELECT id FROM products WHERE id = ? AND org_id = ?")
      .get(productId, betaOrgId);
    assert.equal(other, undefined);
  });

  it("buyer-owned spike rows have no public status column yet (draft contract deferred to M1)", () => {
    // Until M1 adds status/vendor_org_id, every spike row is effectively private
    // (only guardian GET by id). Pin that there is still no public list API.
    const db = marketplaceDb();
    const cols = (db.prepare("PRAGMA table_info(products)").all() as { name: string }[]).map(
      (c) => c.name,
    );
    assert.ok(cols.includes("org_id"));
    assert.ok(cols.includes("vendor_id"));
    assert.equal(cols.includes("status"), false, "status lands in M1");
    assert.equal(cols.includes("vendor_org_id"), false, "vendor_org_id lands in M1");
  });
});
