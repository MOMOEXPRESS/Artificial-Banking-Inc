/**
 * The generated Prisma schema must still describe the live one (P2-T2 stage 2).
 *
 * The previous schema was hand-written and drifted until it modelled 13
 * entities against 50 tables, with its own header listing the mismatches it
 * knew about. A mirror that is maintained by hand is wrong by default; the
 * point of generating it is that this test can tell you the moment it stops
 * matching.
 *
 * If this fails, a migration was added to store.ts without regenerating:
 *   node --import tsx apps/api/scripts/gen-prisma-schema.mjs
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "pv-drift-"));
process.env.POLICYVAULT_DB = join(dir, "drift.db");

const { store } = await import("./store.js");
const Database = (await import("better-sqlite3")).default;

after(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(here, "..", "..", "..", "packages", "db", "prisma", "schema.prisma");

/** Every table the API actually boots with. */
function liveTables(): string[] {
  store.createOrg("Drift Probe", 0n); // run migrations + seeds
  const db = new Database(process.env.POLICYVAULT_DB!, { readonly: true });
  const rows = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all() as { name: string }[];
  db.close();
  return rows.map((r) => r.name);
}

describe("generated Prisma schema", () => {
  const schema = readFileSync(schemaPath, "utf8");
  const mapped = new Set([...schema.matchAll(/@@map\("([^"]+)"\)/g)].map((m) => m[1]));

  it("covers every live table", () => {
    const missing = liveTables().filter((t) => !mapped.has(t));
    assert.deepEqual(
      missing,
      [],
      `schema.prisma is missing ${missing.length} table(s). Regenerate it: ` +
        "node --import tsx apps/api/scripts/gen-prisma-schema.mjs",
    );
  });

  it("describes no table that does not exist", () => {
    // Drift runs both ways: a dropped table leaves a model behind that reads
    // as supported.
    const live = new Set(liveTables());
    const extra = [...mapped].filter((t) => !live.has(t));
    assert.deepEqual(extra, [], `schema.prisma models ${extra.length} table(s) that are gone`);
  });

  it("types money as BigInt, never as a float or a string", () => {
    // The whole reason for generating this file. A `_micro` column that lands
    // as Float loses precision above 2^53 silently; as String it stops being
    // arithmetic at all.
    const moneyFields = [...schema.matchAll(/^\s+(\w*[Mm]icro)\s+(\w+)/gm)];
    assert.ok(moneyFields.length >= 15, "expected the money columns to be present");
    for (const [, name, type] of moneyFields) {
      assert.equal(type, "BigInt", `${name} must be BigInt, found ${type}`);
    }
  });

  it("is marked generated, so nobody hand-edits it back into drift", () => {
    assert.match(schema.split("\n")[0], /GENERATED/);
  });
});
