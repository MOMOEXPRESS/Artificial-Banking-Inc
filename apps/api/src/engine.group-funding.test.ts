import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "abi-group-funding-"));
process.env.POLICYVAULT_DB = join(dir, "funding.db");

const { store } = await import("./store.js");
const { agentFundingContext, executeIntent } = await import("./engine.js");

after(() => rmSync(dir, { recursive: true, force: true }));

function fixture() {
  const org = store.createOrg("Funding test", 100_000_000n);
  const agent = store.createAgent(org.id, "Researcher");
  return { orgId: org.id, agentId: agent.agentId };
}

describe("shared group funding authority", () => {
  it("does not create a budget for a new agent without a group", async () => {
    const { orgId, agentId } = fixture();
    const before = store.listAgentGroups(orgId).length;
    assert.equal(agentFundingContext(agentId, orgId), undefined);
    const result = await executeIntent({
      orgId, agentId, tool: "pay", amountMicro: 1_000_000n,
      amountUsdc: "1", destination: "merchant.example", intentId: "ungrouped-test",
    });
    assert.equal(result.ok, false);
    assert.equal(store.listAgentGroups(orgId).length, before);
  });

  it("refuses ambiguous funding rather than selecting the oldest group", () => {
    const { orgId, agentId } = fixture();
    for (const name of ["Research", "Operations"]) {
      const budget = store.createDepartment(orgId, name);
      const group = store.createAgentGroup(orgId, name, budget.id);
      store.addAgentToGroup(orgId, agentId, group.id);
    }
    assert.equal(agentFundingContext(agentId, orgId), undefined);
    assert.equal(store.listAgentGroups(orgId).length, 2);
  });

  it("does not replace an archived or unfunded membership with a new budget", () => {
    const { orgId, agentId } = fixture();
    const group = store.createAgentGroup(orgId, "Archived");
    store.addAgentToGroup(orgId, agentId, group.id);
    store.setAgentGroupStatus(group.id, "archived");
    assert.equal(agentFundingContext(agentId, orgId), undefined);
    assert.equal(store.listAgentGroups(orgId).length, 1);
  });

  it("moves a funded legacy agent once, preserving balanced books", () => {
    const { orgId, agentId } = fixture();
    store.applyEntries(orgId, [{
      id: `legacy_${agentId}`, orgId, memo: "legacy allocation",
      createdAt: new Date().toISOString(),
      lines: [
        { accountId: `org:${orgId}:available`, deltaMicro: -5_000_000n },
        { accountId: `agent:${agentId}:available`, deltaMicro: 5_000_000n },
      ],
    }]);
    const funding = agentFundingContext(agentId, orgId);
    assert.ok(funding);
    assert.equal(store.getAccountMap(orgId).get(funding.availableId)?.balanceMicro, 5_000_000n);
    assert.equal(store.getAccountMap(orgId).get(`agent:${agentId}:available`)?.balanceMicro, 0n);
    assert.equal(agentFundingContext(agentId, orgId)?.budget.id, funding.budget.id);
    assert.equal(store.listAgentGroups(orgId).length, 1);
    assert.equal(store.reconcileOrgUncached(orgId).ok, true);
  });
});
