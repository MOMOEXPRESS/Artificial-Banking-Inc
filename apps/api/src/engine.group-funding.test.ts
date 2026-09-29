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
      orgId,
      agentId,
      tool: "pay",
      amountMicro: 1_000_000n,
      amountUsdc: "1",
      destination: "merchant.example",
      intentId: "ungrouped-test",
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
    store.applyEntries(orgId, [
      {
        id: `legacy_${agentId}`,
        orgId,
        memo: "legacy allocation",
        createdAt: new Date().toISOString(),
        lines: [
          { accountId: `org:${orgId}:available`, deltaMicro: -5_000_000n },
          { accountId: `agent:${agentId}:available`, deltaMicro: 5_000_000n },
        ],
      },
    ]);
    const funding = agentFundingContext(agentId, orgId);
    assert.ok(funding);
    assert.equal(store.getAccountMap(orgId).get(funding.availableId)?.balanceMicro, 5_000_000n);
    assert.equal(store.getAccountMap(orgId).get(`agent:${agentId}:available`)?.balanceMicro, 0n);
    assert.equal(agentFundingContext(agentId, orgId)?.budget.id, funding.budget.id);
    assert.equal(store.listAgentGroups(orgId).length, 1);
    assert.equal(store.reconcileOrgUncached(orgId).ok, true);
  });

  it("moves a legacy allocation to the selected group without duplicating it", () => {
    const { orgId, agentId } = fixture();
    const budget = store.createDepartment(orgId, "Research");
    const group = store.createAgentGroup(orgId, "Research", budget.id);
    store.applyEntries(orgId, [
      {
        id: `legacy_reassign_${agentId}`,
        orgId,
        memo: "legacy allocation",
        createdAt: new Date().toISOString(),
        lines: [
          { accountId: `org:${orgId}:available`, deltaMicro: -7_000_000n },
          { accountId: `agent:${agentId}:available`, deltaMicro: 7_000_000n },
        ],
      },
    ]);
    assert.equal(store.reassignAgentGroup(orgId, agentId, group.id), "ok");
    assert.equal(store.reassignAgentGroup(orgId, agentId, group.id), "ok");
    assert.equal(agentFundingContext(agentId, orgId)?.budget.id, budget.id);
    assert.equal(
      store.getAccountMap(orgId).get(`dept:${budget.id}:available`)?.balanceMicro,
      7_000_000n,
    );
    assert.equal(store.getAccountMap(orgId).get(`agent:${agentId}:available`)?.balanceMicro, 0n);
    assert.equal(store.reconcileOrgUncached(orgId).ok, true);
  });

  it("blocks reassignment while the old budget has held funds", () => {
    const { orgId, agentId } = fixture();
    const source = store.createDepartment(orgId, "Source");
    const sourceGroup = store.createAgentGroup(orgId, "Source", source.id);
    const target = store.createDepartment(orgId, "Target");
    const targetGroup = store.createAgentGroup(orgId, "Target", target.id);
    store.addAgentToGroup(orgId, agentId, sourceGroup.id);
    store.applyEntries(orgId, [
      {
        id: `held_reassign_${agentId}`,
        orgId,
        memo: "held funds",
        createdAt: new Date().toISOString(),
        lines: [
          { accountId: `org:${orgId}:available`, deltaMicro: -1_000_000n },
          { accountId: `dept:${source.id}:held`, deltaMicro: 1_000_000n },
        ],
      },
    ]);
    assert.equal(store.reassignAgentGroup(orgId, agentId, targetGroup.id), "busy");
    assert.equal(agentFundingContext(agentId, orgId)?.budget.id, source.id);
  });

  it("keeps pending approvals and locked escrow on their original budget", () => {
    const { orgId, agentId } = fixture();
    const source = store.createDepartment(orgId, "Original");
    const sourceGroup = store.createAgentGroup(orgId, "Original", source.id);
    const target = store.createDepartment(orgId, "Next");
    const targetGroup = store.createAgentGroup(orgId, "Next", target.id);
    store.addAgentToGroup(orgId, agentId, sourceGroup.id);
    const now = new Date().toISOString();
    store.createApproval({
      id: `approval_${agentId}`,
      orgId,
      agentId,
      intentId: `intent_${agentId}`,
      tool: "pay",
      amountMicro: 1_000_000n,
      amountUsdc: "1",
      destination: "seller.example",
      idempotencyKey: `key_${agentId}`,
      ruleIds: ["hitl_above"],
      reasons: ["Review"],
      status: "pending",
      createdAt: now,
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    });
    assert.equal(store.reassignAgentGroup(orgId, agentId, targetGroup.id), "busy");
    store.resolveApproval(`approval_${agentId}`, { status: "denied", resolvedAt: now });
    store.createEscrow({
      id: `escrow_${agentId}`,
      orgId,
      payerAgentId: agentId,
      payeeAgentId: agentId,
      amountMicro: 1_000_000n,
      state: "locked",
      createdAt: now,
      timeoutAt: new Date(Date.now() + 600_000).toISOString(),
    });
    assert.equal(store.reassignAgentGroup(orgId, agentId, targetGroup.id), "busy");
    assert.equal(agentFundingContext(agentId, orgId)?.budget.id, source.id);
  });

  it("keeps an unassigned agent from joining a group in another organization", () => {
    const { orgId, agentId } = fixture();
    const other = fixture();
    const budget = store.createDepartment(other.orgId, "Other");
    const group = store.createAgentGroup(other.orgId, "Other", budget.id);
    assert.equal(store.reassignAgentGroup(orgId, agentId, group.id), "invalid");
    assert.equal(agentFundingContext(agentId, orgId), undefined);
  });
});
