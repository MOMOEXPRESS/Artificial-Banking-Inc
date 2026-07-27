/**
 * P2-T4 — tenant isolation as a property of the reader, not of discipline.
 *
 * Isolation used to rest on ~39 hand-written `row.orgId !== org.id` checks at
 * call sites. Every one I audited was correct. The problem was that nothing
 * would notice the fortieth being forgotten: not the compiler, not a test, not
 * a reviewer skimming a route that looks like the twelve above it.
 *
 * These tests are the backstop the audit asked for: one org must never be able
 * to read another's rows, per resource type, through the scoped reader.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "pv-tenant-"));
process.env.POLICYVAULT_DB = join(dir, "tenant.db");

const { store, scopedStore } = await import("./store.js");

after(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

/** Two organizations that know nothing about each other. */
let alpha: { orgId: string; agentId: string; deptId: string; walletId: string; groupId: string };
let beta: { orgId: string; agentId: string };

before(() => {
  const a = store.createOrg("Alpha Co", 1_000_000_000n);
  const aAgent = store.createAgent(a.id, "Alpha Agent");
  const aDept = store.createDepartment(a.id, "Alpha Dept");
  const aWallet = store.createSharedWallet(a.id, "Alpha Wallet");
  const aGroup = store.createAgentGroup(a.id, "Alpha Group");
  alpha = {
    orgId: a.id,
    agentId: aAgent.agentId,
    deptId: aDept.id,
    walletId: aWallet.id,
    groupId: aGroup.id,
  };

  const b = store.createOrg("Beta Co", 1_000_000_000n);
  beta = { orgId: b.id, agentId: store.createAgent(b.id, "Beta Agent").agentId };
});

describe("cross-tenant reads", () => {
  it("returns nothing for another org's agent", () => {
    assert.ok(scopedStore(alpha.orgId).getAgent(alpha.agentId), "own agent is readable");
    assert.equal(scopedStore(beta.orgId).getAgent(alpha.agentId), undefined);
    assert.equal(scopedStore(alpha.orgId).getAgent(beta.agentId), undefined);
  });

  it("returns nothing for another org's department", () => {
    assert.ok(scopedStore(alpha.orgId).getDepartment(alpha.deptId));
    assert.equal(scopedStore(beta.orgId).getDepartment(alpha.deptId), undefined);
  });

  it("returns nothing for another org's shared wallet", () => {
    assert.ok(scopedStore(alpha.orgId).getSharedWallet(alpha.walletId));
    assert.equal(scopedStore(beta.orgId).getSharedWallet(alpha.walletId), undefined);
  });

  it("returns nothing for another org's agent group", () => {
    assert.ok(scopedStore(alpha.orgId).getAgentGroup(alpha.groupId));
    assert.equal(scopedStore(beta.orgId).getAgentGroup(alpha.groupId), undefined);
  });

  it("does not leak group membership across orgs", () => {
    store.addAgentToGroup(alpha.orgId, alpha.agentId, alpha.groupId);
    assert.deepEqual(scopedStore(alpha.orgId).listGroupMemberIds(alpha.groupId), [alpha.agentId]);
    // Beta cannot enumerate Alpha's roster by guessing a group id.
    assert.deepEqual(scopedStore(beta.orgId).listGroupMemberIds(alpha.groupId), []);
  });

  it("does not leak an agent's group list across orgs", () => {
    assert.ok(scopedStore(alpha.orgId).listAgentGroupIds(alpha.agentId).length > 0);
    assert.deepEqual(scopedStore(beta.orgId).listAgentGroupIds(alpha.agentId), []);
  });

  it("does not leak a per-agent policy override across orgs", () => {
    store.setAgentPolicyOverride(alpha.orgId, alpha.agentId, { perTxMaxMicro: 1_000_000n }, "test");
    assert.ok(scopedStore(alpha.orgId).getAgentPolicyOverride(alpha.agentId));
    // An override discloses an org's limits — worth reading only for its owner.
    assert.equal(scopedStore(beta.orgId).getAgentPolicyOverride(alpha.agentId), null);
  });

  it("is indistinguishable from a row that does not exist", () => {
    // Existence is itself information. "Someone else's agent" and "no such
    // agent" must look identical, or ids become an enumeration oracle.
    assert.equal(
      scopedStore(beta.orgId).getAgent(alpha.agentId),
      scopedStore(beta.orgId).getAgent("agt_does_not_exist"),
    );
  });
});

describe("the unscoped readers still exist for background work", () => {
  it("reads across orgs by design, and says so in its name", () => {
    // Sweeps legitimately span tenants. The point of the *AnyOrg suffix is
    // that every such use is greppable rather than invisible.
    assert.ok(store.getAgentAnyOrg(alpha.agentId));
    assert.ok(store.getAgentAnyOrg(beta.agentId));
  });
});
