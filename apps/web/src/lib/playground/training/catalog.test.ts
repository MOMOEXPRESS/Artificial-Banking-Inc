import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MISSIONS, findMission, isTrainingEnabled, TRAINING_STEP_KINDS, estimatedMaxUsd } from ".";
import { planRun } from "../../workflow/engine";
import type { WorkflowCtx } from "../../workflow/types";

describe("Guided scenario catalog (training)", () => {
  it("keeps every guided scenario uniquely addressable", () => {
    const ids = MISSIONS.map((mission) => mission.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("gives every scenario the context the playground shows", () => {
    for (const mission of MISSIONS) {
      assert.ok(mission.title.trim(), `${mission.id} is missing a title`);
      assert.ok(mission.brief.trim(), `${mission.id} is missing a brief`);
      assert.ok(mission.persona.trim(), `${mission.id} is missing a persona`);
      assert.ok(mission.duration.trim(), `${mission.id} is missing a duration`);
      assert.ok(mission.estimatedCost.trim(), `${mission.id} is missing a cost estimate`);
      assert.ok(mission.tags.length > 0, `${mission.id} is missing discovery tags`);
    }
  });

  it("covers every scenario family, each deep enough for progressive testing", () => {
    for (const category of ["commerce", "governance", "security", "ops"] as const) {
      const family = MISSIONS.filter((mission) => mission.category === category);
      const advanced = family.filter((mission) => mission.difficulty === "advanced");
      assert.ok(family.length >= 5, `${category} needs at least five guided scenarios`);
      assert.ok(advanced.length >= 3, `${category} needs at least three advanced scenarios`);
    }
  });

  it("keeps step audit IDs unique inside every guided scenario", () => {
    const context = { e2eWallet: "" } as WorkflowCtx;
    for (const mission of MISSIONS) {
      const ids = mission.build(context).map((step) => step.id);
      assert.equal(new Set(ids).size, ids.length, `${mission.id} contains duplicate step IDs`);
    }
  });

  it("makes the smoke chain an ordinary card that expands into its three members", () => {
    const chain = findMission("smoke_chain");
    assert.ok(chain, "smoke chain card exists");
    const queue = planRun(chain!, "once", findMission).map((m) => m.id);
    assert.deepEqual(queue, ["smoke", "brief", "redteam"]);
    assert.equal(planRun(chain!, "repeat3", findMission).length, 9);
  });

  it("flags drills as destructive and policy-editing setup as such", () => {
    assert.equal(findMission("redteam")?.destructive, true);
    assert.equal(findMission("smoke_chain")?.destructive, true);
    assert.equal(findMission("onchain_wallet")?.editsPolicy, true);
    assert.equal(findMission("brief")?.destructive, false);
  });

  it("is only enabled on testnet (unknown network fails closed)", () => {
    assert.equal(isTrainingEnabled({ network: { testnet: true } }), true);
    assert.equal(isTrainingEnabled({ network: { testnet: false } }), false);
    assert.equal(isTrainingEnabled(null), false);
    assert.equal(isTrainingEnabled({}), false);
  });

  it("offers the red-team drain only as a training step kind", () => {
    assert.ok(TRAINING_STEP_KINDS.some((k) => k.kind === "drain"));
  });

  it("parses cost estimates for the budget check", () => {
    assert.equal(estimatedMaxUsd({ estimatedCost: "Up to $8.50" }), 8.5);
    assert.equal(estimatedMaxUsd({ estimatedCost: "Free" }), 0);
  });
});
