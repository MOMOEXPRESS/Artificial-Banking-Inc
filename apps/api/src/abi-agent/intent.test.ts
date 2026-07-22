import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyIntent } from "./intent.js";
import { planTools } from "./planner.js";

describe("classifyIntent + planTools", () => {
  it("routes recommend / remember / policy", () => {
    assert.equal(classifyIntent("What should I do next?"), "recommend");
    assert.equal(classifyIntent("Remember that Writer is for research only"), "remember");
    assert.equal(classifyIntent("show policy bands"), "policy");
    assert.equal(classifyIntent("are we in quiet hours"), "quiet");
  });

  it("routes agent detail, governance, and decision explain", () => {
    assert.equal(classifyIntent("How is Researcher?"), "agent_detail");
    assert.equal(classifyIntent("who can approve?"), "governance");
    assert.equal(classifyIntent("why was that payment denied?"), "decision_why");
  });

  it("plans recommend_next and remember_fact tools", () => {
    assert.deepEqual(planTools("recommend", "what next"), ["recommend_next"]);
    assert.deepEqual(planTools("remember", "remember that x"), ["remember_fact"]);
    assert.ok(planTools("survey", "hi").includes("org_summary"));
    assert.ok(planTools("decision_why", "why").includes("explain_decision"));
    assert.ok(planTools("governance", "who").includes("governance_status"));
    assert.deepEqual(planTools("agent_detail", "how is x"), ["agent_detail"]);
  });
});
