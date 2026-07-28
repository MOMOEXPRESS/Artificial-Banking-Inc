/**
 * P8-T1 — ops-label membership has exactly one source of truth.
 *
 * `agent_group_members` used to be shadowed by a `profile.groupId` "soft
 * primary": joining a label mirrored it into the agent's profile when that
 * field was empty, and leaving promoted an arbitrary remaining label into it.
 *
 * Two copies of a relationship is two things to disagree. An agent in three
 * labels had one of them silently privileged for no reason a reader could
 * discover, and nothing consumed the field anyway.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "pv-membership-"));
process.env.POLICYVAULT_DB = join(dir, "membership.db");

const { store, scopedStore } = await import("./store.js");

after(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

function fixture(name: string) {
  const org = store.createOrg(name, 1_000_000_000n);
  const agent = store.createAgent(org.id, "Researcher");
  return { orgId: org.id, agentId: agent.agentId };
}

describe("ops-label membership", () => {
  it("is recorded in the join table and nowhere else", () => {
    const { orgId, agentId } = fixture("Single Label Co");
    const label = store.createAgentGroup(orgId, "Finance");

    store.addAgentToGroup(orgId, agentId, label.id);

    assert.deepEqual(scopedStore(orgId).listAgentGroupIds(agentId), [label.id]);
    const profile = store.getAgentAnyOrg(agentId)?.profile ?? {};
    assert.equal(
      (profile as Record<string, unknown>).groupId,
      undefined,
      "profile must not carry a shadow copy of membership",
    );
  });

  it("treats every label equally — none is a hidden primary", () => {
    const { orgId, agentId } = fixture("Many Labels Co");
    const finance = store.createAgentGroup(orgId, "Finance");
    const research = store.createAgentGroup(orgId, "Research");
    const ops = store.createAgentGroup(orgId, "Ops");

    store.addAgentToGroup(orgId, agentId, finance.id);
    store.addAgentToGroup(orgId, agentId, research.id);
    store.addAgentToGroup(orgId, agentId, ops.id);

    const ids = scopedStore(orgId).listAgentGroupIds(agentId);
    assert.equal(ids.length, 3);
    for (const id of [finance.id, research.id, ops.id]) {
      assert.ok(ids.includes(id));
    }
  });

  it("leaving one label does not disturb the others", () => {
    // The old behaviour promoted an arbitrary remaining label into the profile
    // here, which read as a state change nobody asked for.
    const { orgId, agentId } = fixture("Leaving Co");
    const a = store.createAgentGroup(orgId, "Alpha");
    const b = store.createAgentGroup(orgId, "Beta");
    store.addAgentToGroup(orgId, agentId, a.id);
    store.addAgentToGroup(orgId, agentId, b.id);

    store.removeAgentFromGroup(agentId, a.id);

    assert.deepEqual(scopedStore(orgId).listAgentGroupIds(agentId), [b.id]);
    assert.equal(
      (store.getAgentAnyOrg(agentId)?.profile as Record<string, unknown>).groupId,
      undefined,
    );
  });

  it("is idempotent — joining twice is joining once", () => {
    const { orgId, agentId } = fixture("Rejoin Co");
    const label = store.createAgentGroup(orgId, "Finance");

    store.addAgentToGroup(orgId, agentId, label.id);
    store.addAgentToGroup(orgId, agentId, label.id);

    assert.deepEqual(scopedStore(orgId).listGroupMemberIds(label.id), [agentId]);
  });

  it("leaves descriptive profile fields untouched", () => {
    // Profile is metadata about the agent. Membership changes should not
    // rewrite it at all, which is the whole point of separating them.
    const { orgId, agentId } = fixture("Profile Intact Co");
    const label = store.createAgentGroup(orgId, "Finance");
    store.setAgentProfile(agentId, { tags: ["research"], runtime: "python" });

    store.addAgentToGroup(orgId, agentId, label.id);
    store.removeAgentFromGroup(agentId, label.id);

    assert.deepEqual(store.getAgentAnyOrg(agentId)?.profile, {
      tags: ["research"],
      runtime: "python",
    });
  });
});
