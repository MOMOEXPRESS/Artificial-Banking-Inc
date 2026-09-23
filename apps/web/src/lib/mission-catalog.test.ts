import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MISSIONS, compileCustomMission, newCustomStep } from "./mission";

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
