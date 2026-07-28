import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.POLICYVAULT_DB = join(mkdtempSync(join(tmpdir(), "pv-schema-")), "s.db");
const { store } = await import("../src/store.js");
store.createOrg("Schema Probe", 0n); // force migrations + seeds to run
const Database = (await import("better-sqlite3")).default;
const db = new Database(process.env.POLICYVAULT_DB, { readonly: true });
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
const out = [];
for (const { name } of tables) {
  const cols = db.prepare(`PRAGMA table_info(${name})`).all();
  const fks = db.prepare(`PRAGMA foreign_key_list(${name})`).all();
  const idx = db.prepare(`PRAGMA index_list(${name})`).all();
  const uniques = [];
  for (const i of idx) {
    if (!i.unique) continue;
    const info = db.prepare(`PRAGMA index_info(${i.name})`).all();
    uniques.push(info.map((c) => c.name));
  }
  out.push({ name, cols, fks, uniques });
}
console.log(JSON.stringify(out, null, 1));
