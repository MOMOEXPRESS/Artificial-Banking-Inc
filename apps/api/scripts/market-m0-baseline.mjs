/**
 * M0 baseline: seed N products and measure local list / filter latency.
 * Writes docs/marketplace/baseline-m0.json. Zero network. Mock DB only.
 *
 * Run: node --import tsx apps/api/scripts/market-m0-baseline.mjs
 */
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const N = Number(process.env.ABI_MARKET_BASELINE_N ?? 10_000);
const dir = mkdtempSync(join(tmpdir(), "pv-m0-base-"));
process.env.POLICYVAULT_DB = join(dir, "baseline.db");
process.env.ABI_CHAT_LLM = "0";
process.env.ABI_NO_LISTEN = "1";
process.env.POLICYVAULT_ALLOW_BOOTSTRAP = "0";

const { store, marketplaceDb } = await import("../src/store.js");

function pct(sorted, p) {
  if (sorted.length === 0) return null;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i];
}

function bench(label, rounds, fn) {
  const samples = [];
  for (let i = 0; i < rounds; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  return {
    label,
    rounds,
    p50Ms: Number(pct(samples, 50).toFixed(3)),
    p95Ms: Number(pct(samples, 95).toFixed(3)),
    maxMs: Number(samples[samples.length - 1].toFixed(3)),
  };
}

const org = store.createOrg("Baseline Seller", 0n);
const db = marketplaceDb();
const insert = db.prepare(`
  INSERT INTO products (
    id, org_id, name, description, category, price_micro, currency,
    stock_level, vendor_id, images_json, attributes_json, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, 'USDC', ?, ?, '[]', ?, ?, ?)
`);

const categories = ["outdoor", "data", "research", "ai-model", "finance", "other"];
const tSeed0 = performance.now();
const now = new Date().toISOString();
const tx = db.transaction((n) => {
  for (let i = 0; i < n; i++) {
    const id = `prod_base_${i.toString(16).padStart(8, "0")}`;
    const cat = categories[i % categories.length];
    const price = String(1_000_000 + (i % 500) * 100_000);
    insert.run(
      id,
      org.id,
      `Baseline product ${i}`,
      `Seeded description for product ${i} hiking backpack dataset gpu`,
      cat,
      price,
      i % 7 === 0 ? 0 : 10 + (i % 20),
      `vendor_${i % 50}`,
      JSON.stringify({ size: `${20 + (i % 10)}L`, region: i % 2 ? "FR" : "US" }),
      now,
      now,
    );
  }
});
tx(N);
const seedMs = performance.now() - tSeed0;

const listByCategory = bench("list_category_outdoor_limit_25", 40, () => {
  db.prepare(
    `SELECT id, name, price_micro, category FROM products WHERE org_id = ? AND category = ? LIMIT 25`,
  ).all(org.id, "outdoor");
});

const includesStyle = bench("js_includes_filter_all_names", 10, () => {
  const rows = db.prepare(`SELECT id, name, description, category FROM products`).all();
  const q = "hiking";
  rows.filter((r) => `${r.name} ${r.description} ${r.category}`.toLowerCase().includes(q));
});

const countRows = db.prepare(`SELECT COUNT(*) AS c FROM products`).get().c;
const pageBytes = JSON.stringify(
  db
    .prepare(
      `SELECT id, name, description, category, price_micro, attributes_json FROM products LIMIT 25`,
    )
    .all(),
).length;

const out = {
  commitHint: "2703595",
  generatedAt: new Date().toISOString(),
  n: N,
  seedMs: Number(seedMs.toFixed(1)),
  countRows,
  approxPage25JsonBytes: pageBytes,
  approxBytesPerProduct: Number((pageBytes / 25).toFixed(1)),
  measurements: [listByCategory, includesStyle],
  note: "Local better-sqlite3; Durable Object latency will differ. Directory today loads all offers then JS-filters (seller-routes).",
  fingerprint: createHash("sha256")
    .update(String(N) + org.id)
    .digest("hex")
    .slice(0, 12),
};

const outPath = join(repoRoot, "docs/marketplace/baseline-m0.json");
writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out, null, 2));

try {
  rmSync(dir, { recursive: true, force: true });
} catch {
  /* ignore */
}
