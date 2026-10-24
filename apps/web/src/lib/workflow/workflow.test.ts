import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AgentClient, FlowResult, GuardianClient } from "../flows/client";
import { CUSTOM_STEP_CATALOG, compileCustomMission, maxSpend, newCustomStep } from "./builder";
import { approvalIdOf, planRun, runMission } from "./engine";
import type { Mission, RunStep, WorkflowCtx } from "./types";

type Call = { who: "agent" | "guardian"; method: string; path: string; body?: unknown };

function fakes(agentAnswer: (path: string, body?: unknown) => FlowResult) {
  const calls: Call[] = [];
  const agent: AgentClient = {
    async call(method, path, body) {
      calls.push({ who: "agent", method, path, body });
      return agentAnswer(path, body);
    },
  };
  const guardian: GuardianClient = {
    async call(method, path, body) {
      calls.push({ who: "guardian", method, path, body });
      return { status: 200, data: { ok: true } };
    },
  };
  return { calls, agent, guardian };
}

function ctxFor(
  agent: AgentClient,
  guardian: GuardianClient,
  out: { steps: RunStep[] },
): WorkflowCtx {
  return {
    agent,
    guardian,
    agentId: "ag_1",
    agentName: "Researcher",
    sellerUrl: null,
    runId: "run_test",
    emit: (s) => (out.steps = s),
    onBlocked: () => {},
    onUnblocked: () => {},
    log: () => {},
    cancelled: () => false,
  };
}

describe("workflow builder", () => {
  it("defaults spend steps to dry runs (no pay endpoint is called)", async () => {
    const f = fakes((path) =>
      path.endsWith("/simulate")
        ? { status: 200, data: { outcome: "allow", ruleIds: ["default_allow"] } }
        : { status: 200, data: { availableUsdc: "40", dailyRemainingUsdc: "40" } },
    );
    const mission = compileCustomMission({
      title: "t",
      steps: [newCustomStep("budget"), newCustomStep("pay_api"), newCustomStep("x402")],
    });
    assert.equal(mission.estimatedCost, "$0 (dry run)");
    const out = { steps: [] as RunStep[] };
    await runMission(mission, ctxFor(f.agent, f.guardian, out));
    const paths = f.calls.filter((c) => c.who === "agent").map((c) => c.path);
    assert.ok(!paths.some((p) => p.includes("/pay")), `no pay call in dry run: ${paths.join(",")}`);
    assert.ok(paths.includes("/v1/agent/simulate"));
    assert.ok(out.steps.every((s) => s.status === "done"));
  });

  it("calls the real pay endpoint only with real spend on", async () => {
    const f = fakes(() => ({ status: 200, data: { amountUsdc: "5", rail: "mock" } }));
    const mission = compileCustomMission(
      { title: "t", steps: [newCustomStep("pay_api")] },
      { realSpend: true },
    );
    await runMission(mission, ctxFor(f.agent, f.guardian, { steps: [] }));
    assert.ok(f.calls.some((c) => c.who === "agent" && c.path === "/v1/agent/pay_api"));
    assert.equal(maxSpend([newCustomStep("pay_api"), newCustomStep("budget")]), 5);
  });

  it("does not expose drills in the core step catalog", () => {
    assert.ok(!CUSTOM_STEP_CATALOG.some((k) => k.kind === "drain"));
  });
});

describe("workflow engine", () => {
  it("saves the run record through the guardian client, never a bearer header", async () => {
    const f = fakes(() => ({ status: 200, data: { availableUsdc: "1", dailyRemainingUsdc: "1" } }));
    const mission = compileCustomMission({ title: "t", steps: [newCustomStep("budget")] });
    await runMission(mission, ctxFor(f.agent, f.guardian, { steps: [] }));
    const saves = f.calls.filter(
      (c) => c.who === "guardian" && c.path === "/v1/guardian/runs/run_test",
    );
    assert.ok(saves.length >= 2);
    assert.equal((saves.at(-1)!.body as { status: string }).status, "complete");
  });

  it("parks on approval, then continues when approved", async () => {
    let polls = 0;
    const f = fakes((path) => {
      if (path === "/v1/agent/pay_api") return { status: 202, data: { approvalId: "apr_1" } };
      if (path.startsWith("/v1/agent/approvals/")) {
        polls += 1;
        return { status: 200, data: { approval: { status: polls > 1 ? "approved" : "pending" } } };
      }
      return { status: 200, data: { availableUsdc: "1", dailyRemainingUsdc: "1" } };
    });
    const mission = compileCustomMission(
      { title: "t", steps: [newCustomStep("pay_api"), newCustomStep("summarize")] },
      { realSpend: true },
    );
    const out = { steps: [] as RunStep[] };
    await runMission(mission, ctxFor(f.agent, f.guardian, out));
    assert.equal(out.steps[0].status, "done");
    assert.equal(out.steps[1].status, "done");
  });

  it("resumes a persisted run at the parked step", async () => {
    const f = fakes((path) =>
      path.startsWith("/v1/agent/approvals/apr_9")
        ? { status: 200, data: { approval: { status: "denied" } } }
        : { status: 200, data: { availableUsdc: "1", dailyRemainingUsdc: "1" } },
    );
    const mission = compileCustomMission(
      {
        title: "t",
        steps: [newCustomStep("budget"), newCustomStep("pay_api"), newCustomStep("summarize")],
      },
      { realSpend: true, id: "custom_x" },
    );
    const defs = mission.build({} as WorkflowCtx);
    const out = { steps: [] as RunStep[] };
    await runMission(mission, ctxFor(f.agent, f.guardian, out), {
      startedAt: new Date().toISOString(),
      steps: [
        { id: defs[0].id, title: "b", detail: "", status: "done", summary: "ok" },
        {
          id: defs[1].id,
          title: "p",
          detail: "",
          status: "blocked",
          output: '{"approvalId":"apr_9"}',
        },
        { id: defs[2].id, title: "s", detail: "", status: "pending" },
      ],
    });
    // The finished step is not re-run; no new pay call is made.
    assert.ok(!f.calls.some((c) => c.path === "/v1/agent/pay_api"));
    assert.equal(out.steps[0].status, "done");
    assert.equal(out.steps[1].status, "failed");
    assert.equal(out.steps[2].status, "done");
  });

  it("stopping while parked leaves the approval pending and cancels the run", async () => {
    let stop = false;
    const f = fakes((path) => {
      if (path === "/v1/agent/pay_api") return { status: 202, data: { approvalId: "apr_2" } };
      stop = true;
      return { status: 200, data: { approval: { status: "pending" } } };
    });
    const mission = compileCustomMission(
      { title: "t", steps: [newCustomStep("pay_api")] },
      { realSpend: true },
    );
    const ctx = { ...ctxFor(f.agent, f.guardian, { steps: [] }), cancelled: () => stop };
    await runMission(mission, ctx);
    const last = f.calls.filter((c) => c.who === "guardian").at(-1)!;
    assert.equal((last.body as { status: string }).status, "cancelled");
    assert.ok(!f.calls.some((c) => c.path.includes("/resolve")));
  });

  it("reads the approval id back from a saved step", () => {
    assert.equal(approvalIdOf({ output: JSON.stringify({ approvalId: "apr_x" }) }), "apr_x");
    assert.equal(approvalIdOf({ approvalId: "apr_y" }), "apr_y");
    assert.equal(approvalIdOf({ output: "nope" }), undefined);
  });

  it("plans single missions and repeats", () => {
    const m = { id: "a", chain: undefined } as unknown as Mission;
    assert.equal(planRun(m, "once", () => undefined).length, 1);
    assert.equal(planRun(m, "repeat3", () => undefined).length, 3);
  });
});
