/**
 * Runs the store contract against the SQLite backend.
 *
 * When a Postgres implementation lands (P2-T2), it gets a sibling file that
 * calls `runStoreConformance` with it and nothing else. Any behaviour the two
 * do not share shows up here rather than in production.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "pv-conformance-"));
process.env.POLICYVAULT_DB = join(dir, "conformance.db");

const { store, scopedStore } = await import("./store.js");
const { runStoreConformance } = await import("./store.conformance.js");

after(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

runStoreConformance("sqlite", { store, scopedStore });
