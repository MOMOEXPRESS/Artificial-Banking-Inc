/**
 * Generate the Prisma schema from the live SQLite schema (P2-T2 stage 2).
 *
 * The previous schema was hand-written, described itself as aspirational, and
 * modelled 13 entities against 50 live tables. A hand-maintained mirror of a
 * schema that changes every phase is a document that is wrong by default; this
 * derives it instead, from a database the store itself just migrated.
 *
 * Run: node --import tsx apps/api/scripts/gen-prisma-schema.mjs
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "..", "..", "packages", "db", "prisma", "schema.prisma");

process.env.POLICYVAULT_DB = join(mkdtempSync(join(tmpdir(), "pv-gen-")), "gen.db");
const { store } = await import("../src/store.js");
// Creating an org runs every migration and seed, so the file reflects the
// schema the API actually boots with — not the CREATE TABLE statements alone.
store.createOrg("Schema Probe", 0n);

const Database = (await import("better-sqlite3")).default;
const db = new Database(process.env.POLICYVAULT_DB, { readonly: true });

/** snake_case table -> PascalCase model. */
const model = (t) => t.split("_").map((p) => p[0].toUpperCase() + p.slice(1)).join("");
/** snake_case column -> camelCase field. */
const field = (c) => c.replace(/_([a-z])/g, (_, x) => x.toUpperCase());

/**
 * Money is bigint micro-USDC, stored as TEXT in SQLite. In Postgres it becomes
 * int8, which Prisma maps to a JS BigInt — exact, and the same type the engine
 * already uses. Deliberately not Decimal: that maps to Decimal.js and would put
 * a conversion between the ledger and its own arithmetic.
 */
const isMoney = (name) => /_micro$/.test(name);

function prismaType(col) {
  if (isMoney(col.name)) return "BigInt";
  if (col.type === "INTEGER") return "Int";
  return "String";
}

function defaultFor(col) {
  if (col.dflt_value === null || col.dflt_value === undefined) return "";
  const v = String(col.dflt_value);
  const unquoted = v.replace(/^'(.*)'$/, "$1");
  // Money columns are TEXT in SQLite, so their defaults are quoted strings
  // ('0'). As int8 the default has to be a number. This mismatch is the first
  // real piece of drift the generated schema surfaced, and it would have been
  // a runtime error on the first insert.
  if (isMoney(col.name)) {
    return /^-?\d+$/.test(unquoted) ? ` @default(${unquoted})` : "";
  }
  if (/^'.*'$/.test(v)) return ` @default("${unquoted}")`;
  if (/^-?\d+$/.test(v)) return ` @default(${v})`;
  return ""; // expressions (CURRENT_TIMESTAMP etc.) are left to the app
}

const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .all();

const lines = [
  "// GENERATED — do not edit by hand.",
  "//",
  "// Source: the live SQLite schema, after every migration in apps/api/src/store.ts",
  "// has run. Regenerate with:",
  "//   node --import tsx apps/api/scripts/gen-prisma-schema.mjs",
  "//",
  "// Any Postgres implementation must pass apps/api/src/store.conformance.ts.",
  "// See docs/adr/2026-07-27-postgres-migration-contract.md for why that suite",
  "// exists and what it protects.",
  "//",
  "// Two deliberate choices:",
  "//   * `*_micro` columns are BigInt (int8), not Decimal. They hold bigint",
  "//     micro-USDC, and Prisma maps int8 to a JS BigInt — the same type the",
  "//     ledger already uses, with no conversion in between.",
  "//   * No Prisma relations are emitted. The store addresses rows by explicit",
  "//     id and never traverses, so relations would be inferred decoration",
  "//     that has to be kept correct for no reader. Foreign keys are recorded",
  "//     as comments and indexes.",
  "",
  "generator client {",
  '  provider = "prisma-client-js"',
  "}",
  "",
  "datasource db {",
  '  provider = "postgresql"',
  "  url      = env(\"DATABASE_URL\")",
  "}",
  "",
];

let modelCount = 0;
let fieldCount = 0;

for (const { name } of tables) {
  const cols = db.prepare(`PRAGMA table_info(${name})`).all();
  const fks = db.prepare(`PRAGMA foreign_key_list(${name})`).all();
  const indexes = db.prepare(`PRAGMA index_list(${name})`).all();

  const pkCols = cols.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk);
  const fkByCol = new Map(fks.map((f) => [f.from, `${f.table}.${f.to}`]));

  lines.push(`model ${model(name)} {`);
  for (const col of cols) {
    const optional = col.notnull === 0 && col.pk === 0 ? "?" : "";
    const attrs = [];
    if (pkCols.length === 1 && col.pk === 1) attrs.push("@id");
    if (col.name !== field(col.name)) attrs.push(`@map("${col.name}")`);
    const def = defaultFor(col);
    const fk = fkByCol.get(col.name);
    const comment = fk ? ` // -> ${fk}` : "";
    lines.push(
      `  ${field(col.name)} ${prismaType(col)}${optional}${def}${attrs.length ? " " + attrs.join(" ") : ""}${comment}`,
    );
    fieldCount++;
  }

  if (pkCols.length > 1) {
    lines.push(`  @@id([${pkCols.map((c) => field(c.name)).join(", ")}])`);
  }

  for (const idx of indexes) {
    const info = db.prepare(`PRAGMA index_info(${idx.name})`).all();
    const names = info.map((i) => field(i.name)).filter(Boolean);
    if (!names.length) continue;
    // A single-column unique on the primary key is already expressed by @id.
    if (idx.unique && pkCols.length === 1 && names.length === 1 && names[0] === field(pkCols[0].name)) {
      continue;
    }
    lines.push(`  ${idx.unique ? "@@unique" : "@@index"}([${names.join(", ")}])`);
  }

  lines.push(`  @@map("${name}")`);
  lines.push("}");
  lines.push("");
  modelCount++;
}

writeFileSync(OUT, lines.join("\n"), "utf8");
console.log(`wrote ${OUT}`);
console.log(`models: ${modelCount}  fields: ${fieldCount}`);
