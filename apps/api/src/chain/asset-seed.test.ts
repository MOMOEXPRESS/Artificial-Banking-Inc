/**
 * Testnet asset roster: real Base Sepolia contracts, native gas on the active
 * chain, and mainnet-only tokens hidden — without deleting anyone's data.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import Database from "better-sqlite3";

const dir = mkdtempSync(join(tmpdir(), "pv-assets-"));
const dbPath = join(dir, "assets.db");
process.env.POLICYVAULT_DB = dbPath;
delete process.env.CHAIN;

after(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

const { store } = await import("../store.js");

describe("asset seed and migration", () => {
  it("EURC points at the real Base Sepolia contract", () => {
    const eurc = store.getAsset("asset_eurc");
    assert.equal(eurc?.contract, "0x808456652fdb597867f38412077A9182bf77359F");
    assert.equal(eurc?.chain, "base-sepolia");
  });

  it("ETH is native gas on the active chain", () => {
    const eth = store.getAsset("asset_eth");
    assert.equal(eth?.chain, "base-sepolia");
    assert.equal(eth?.contract, null);
  });

  it("hides Ethereum-mainnet USDT and DAI on testnet unless the org recorded a balance", () => {
    const org = store.createOrg("Roster Co", 0n);
    const ids = store.listAssets(org.id).map((a) => a.id);
    assert.ok(ids.includes("asset_usdc"));
    assert.ok(ids.includes("asset_eurc"));
    assert.ok(ids.includes("asset_eth"));
    assert.ok(!ids.includes("asset_usdt"));
    assert.ok(!ids.includes("asset_dai"));

    // Existing hand-recorded data stays visible.
    store.setOrgAssetBalance(org.id, "asset_dai", 5n);
    assert.ok(store.listAssets(org.id).some((a) => a.id === "asset_dai"));
    // And the rows themselves are never deleted.
    assert.ok(store.getAsset("asset_usdt"));
  });

  it("migrates an old database in place", () => {
    const raw = new Database(dbPath);
    raw
      .prepare("UPDATE assets SET contract = ? WHERE id = 'asset_eurc'")
      .run("0x808456652fdb597867f384939655eD02696bA000");
    raw.prepare("UPDATE assets SET chain = 'ethereum' WHERE id = 'asset_eth'").run();
    raw.close();
    // The fixes run at startup; re-run them the way a restart would.
    store.runAssetMigrations();
    assert.equal(
      store.getAsset("asset_eurc")?.contract,
      "0x808456652fdb597867f38412077A9182bf77359F",
    );
    assert.equal(store.getAsset("asset_eth")?.chain, "base-sepolia");
  });
});
