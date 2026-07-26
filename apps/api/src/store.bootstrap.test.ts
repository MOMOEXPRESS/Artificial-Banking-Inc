/**
 * Demo seeding and the local reset must behave differently, and the difference
 * is a security property, not a preference:
 *
 *  - `seedDemoOrg()` is reachable over HTTP. It must NEVER touch another
 *    organization. It previously wiped all 34 tables, so an anonymous POST
 *    destroyed every tenant's ledger and vault keys.
 *  - `resetAllData()` is local-only. It must delete in foreign-key-safe order,
 *    otherwise it fails partway and leaves the database inconsistent.
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

/** Give an org the child rows that made the old wipe order fail. */
function withOpsHistory(orgId: string, agentId: string) {
  const group = store.createAgentGroup(orgId, "Lab ops");
  store.addAgentToGroup(orgId, agentId, group.id);
  store.setAgentGroupAutoFund(group.id, {
    enabled: true,
    thresholdUsdc: "5",
    topUpUsdc: "10",
    minIntervalMinutes: 60,
  });
  store.recordAutoFundRun({ orgId, groupId: group.id, agentId, amountMicro: 10_000_000n });
  return group;
}

describe("seedDemoOrg", () => {
  it("never modifies an existing organization", () => {
    const first = store.seedDemoOrg();
    const group = withOpsHistory(first.orgId, first.researcherAgentId);
    const balanceBefore = store
      .getAccountMap(first.orgId)
      .get(`agent:${first.researcherAgentId}:available`)?.balanceMicro;

    const second = store.seedDemoOrg();

    // The new org is genuinely separate...
    assert.notEqual(second.orgId, first.orgId);
    assert.ok(second.guardianKey.startsWith("pv_guardian_"));
    assert.equal(store.listAgentGroups(second.orgId).length, 0);

    // ...and the first org is completely untouched. This is the assertion that
    // would have caught the unauthenticated-wipe defect.
    assert.ok(store.getOrg(first.orgId), "first org must still exist");
    assert.equal(store.listAgents(first.orgId).length, 2);
    assert.equal(store.listAgentGroups(first.orgId).length, 1);
    assert.equal(store.listAgentGroups(first.orgId)[0]!.id, group.id);
    assert.equal(
      store.getAccountMap(first.orgId).get(`agent:${first.researcherAgentId}:available`)
        ?.balanceMicro,
      balanceBefore,
    );
    assert.ok(store.getVaultAddress(first.orgId), "first org vault must survive");
  });
});

describe("resetAllData", () => {
  it("deletes in foreign-key-safe order with ops history present", () => {
    const org = store.seedDemoOrg();
    withOpsHistory(org.orgId, org.researcherAgentId);

    store.resetAllData();

    assert.equal(store.listOrgIds().length, 0);
    assert.equal(store.getOrg(org.orgId), undefined);

    // Still usable afterwards — a partial wipe would break the next seed.
    const fresh = store.seedDemoOrg();
    assert.ok(fresh.orgId);
    assert.equal(store.listAgents(fresh.orgId).length, 2);
  });
});
