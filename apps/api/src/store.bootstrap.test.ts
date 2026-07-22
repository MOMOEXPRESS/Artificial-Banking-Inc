/**
 * Bootstrap must wipe ops-label membership + auto-fund runs before groups/agents,
 * otherwise FOREIGN KEY constraint fails on a warm Vercel /tmp DB.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "pv-bootstrap-"));
process.env.POLICYVAULT_DB = join(dir, "boot.db");
process.env.POLICYVAULT_ALLOW_BOOTSTRAP = "1";
process.env.ABI_KEY_PEPPER = "test-pepper";

const { store } = await import("./store.js");

after(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("bootstrapDemo wipe order", () => {
  it("succeeds after ops-label membership + auto-fund history exist", () => {
    const first = store.bootstrapDemo();
    const group = store.createAgentGroup(first.orgId, "Lab ops");
    store.addAgentToGroup(first.orgId, first.researcherAgentId, group.id);
    store.setAgentGroupAutoFund(group.id, {
      enabled: true,
      thresholdUsdc: "5",
      topUpUsdc: "10",
      minIntervalMinutes: 60,
    });
    store.recordAutoFundRun({
      orgId: first.orgId,
      groupId: group.id,
      agentId: first.researcherAgentId,
      amountMicro: 10_000_000n,
    });

    const second = store.bootstrapDemo();
    assert.notEqual(second.orgId, first.orgId);
    assert.ok(second.guardianKey.startsWith("pv_guardian_"));
    assert.equal(store.listAgentGroups(second.orgId).length, 0);
  });
});
