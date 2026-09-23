import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MISSIONS, compileCustomMission, newCustomStep, type MissionCtx } from "./mission";

describe("Playground mission catalog", () => {
  it("keeps every guided scenario uniquely addressable", () => {
    const ids = MISSIONS.map((mission) => mission.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("gives every scenario the context required by the Agent Lab", () => {
    for (const mission of MISSIONS) {
      assert.ok(mission.title.trim(), `${mission.id} is missing a title`);
      assert.ok(mission.brief.trim(), `${mission.id} is missing a brief`);
      assert.ok(mission.persona.trim(), `${mission.id} is missing a persona`);
      assert.ok(mission.duration.trim(), `${mission.id} is missing a duration`);
      assert.ok(mission.estimatedCost.trim(), `${mission.id} is missing a cost estimate`);
      assert.ok(mission.tags.length > 0, `${mission.id} is missing discovery tags`);
    }
  });

  it("covers every scenario family in the guided library", () => {
    const categories = new Set(MISSIONS.map((mission) => mission.category));
    assert.deepEqual(categories, new Set(["commerce", "governance", "security", "ops"]));
  });

  it("keeps every scenario family deep enough for progressive testing", () => {
    for (const category of ["commerce", "governance", "security", "ops"] as const) {
      const family = MISSIONS.filter((mission) => mission.category === category);
      const advanced = family.filter((mission) => mission.difficulty === "advanced");
      assert.ok(family.length >= 5, `${category} needs at least five guided scenarios`);
      assert.ok(advanced.length >= 3, `${category} needs at least three advanced scenarios`);
    }
  });

  it("keeps step audit IDs unique inside every guided scenario", () => {
    const context = {
      e2eWallet: "",
    } as MissionCtx;

    for (const mission of MISSIONS) {
      const ids = mission.build(context).map((step) => step.id);
      assert.equal(new Set(ids).size, ids.length, `${mission.id} contains duplicate step IDs`);
    }
  });

  it("compiles custom run sheets with complete Agent Lab metadata", () => {
    const custom = compileCustomMission({
      title: "Policy boundary check",
      brief: "Test the current payment boundary.",
      steps: [newCustomStep("budget"), newCustomStep("simulate")],
    });

    assert.equal(custom.expectedOutcome, "mixed");
    assert.equal(custom.difficulty, "advanced");
    assert.equal(custom.estimatedCost, "Depends on steps");
    assert.deepEqual(custom.tags, ["custom", "policy test"]);
  });
});
