/**
 * A11 regression: claimEscrow is a CAS locked→settling so only one settler proceeds.
 * Uses an isolated temp SQLite file via POLICYVAULT_DB before importing the store.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "pv-escrow-"));
process.env.POLICYVAULT_DB = join(dir, "claim.db");

const { store } = await import("./store.js");

after(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("claimEscrow CAS (A11)", () => {
  it("allows only one claim from locked, and unclaim restores locked", () => {
    const demo = store.seedDemoOrg();
    const escrowId = `esc_test_${Date.now()}`;
    const now = new Date().toISOString();
    const timeoutAt = new Date(Date.now() + 60_000).toISOString();

    store.createEscrow({
      id: escrowId,
      orgId: demo.orgId,
      payerAgentId: demo.researcherAgentId,
      payeeAgentId: demo.writerAgentId,
      amountMicro: 5_000_000n,
      state: "locked",
      memo: "claimEscrow unit test",
      createdAt: now,
      timeoutAt,
    });

    assert.equal(store.getEscrow(escrowId, demo.orgId)?.state, "locked");
    assert.equal(store.claimEscrow(escrowId), true);
    assert.equal(store.getEscrow(escrowId, demo.orgId)?.state, "settling");
    assert.equal(store.claimEscrow(escrowId), false, "second claim must lose the race");
    assert.equal(store.getEscrow(escrowId, demo.orgId)?.state, "settling");

    store.unclaimEscrow(escrowId);
    assert.equal(store.getEscrow(escrowId, demo.orgId)?.state, "locked");
    assert.equal(store.claimEscrow(escrowId), true);
    assert.equal(store.getEscrow(escrowId, demo.orgId)?.state, "settling");
  });
});
