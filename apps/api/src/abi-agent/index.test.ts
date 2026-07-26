import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "pv-abi-"));
process.env.POLICYVAULT_DB = join(dir, "abi.db");
process.env.POLICYVAULT_ALLOW_BOOTSTRAP = "1";
process.env.ABI_KEY_PEPPER = "test-pepper";
process.env.ABI_CHAT_LLM = "0"; // keyword path by default

const { store } = await import("../store.js");
const { runAbiAgent } = await import("./index.js");
const { clearExternalProposalsForTests, resolveExternalProposal } = await import(
  "./external-actions.js"
);
const { runLlmToolLoop } = await import("./llm-loop.js");
const { bindAgents, bindEntities } = await import("./entities.js");
const { classifyIntent } = await import("./intent.js");

after(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

afterEach(() => {
  clearExternalProposalsForTests();
  delete process.env.OPENAI_API_KEY;
  process.env.ABI_CHAT_LLM = "0";
});

describe("runAbiAgent", () => {
  it("surveys agents and approvals with tools", async () => {
    const demo = store.seedDemoOrg();
    const res = await runAbiAgent(demo.orgId, "how are the agents and any pending approvals?");
    assert.ok(res.toolsUsed.includes("list_agents"));
    assert.ok(res.toolsUsed.includes("pending_approvals"));
    assert.match(res.answer, /Agents/);
    assert.match(res.answer, /Researcher/);
  });

  it("reuses prior tools on a short follow-up", async () => {
    const demo = store.seedDemoOrg();
    const first = await runAbiAgent(demo.orgId, "list our agents");
    assert.ok(first.toolsUsed.includes("list_agents"));
    const second = await runAbiAgent(demo.orgId, "what about them?", [
      { role: "user", body: "list our agents" },
      {
        role: "assistant",
        body: first.answer,
        meta: { toolsUsed: first.toolsUsed, scratchpad: first.scratchpad },
      },
    ]);
    assert.ok(second.toolsUsed.includes("list_agents") || second.toolsUsed.includes("agent_detail"));
  });

  it("drafts a marketing blurb without moving money", async () => {
    const demo = store.seedDemoOrg();
    const res = await runAbiAgent(demo.orgId, "draft a marketing blurb");
    assert.ok(res.toolsUsed.includes("draft_marketing_blurb"));
    assert.match(res.answer, /Draft \(not published/);
    assert.doesNotMatch(res.answer, /transfer|approve payment|move \$/i);
  });

  it("reports denials and books health", async () => {
    const demo = store.seedDemoOrg();
    const res = await runAbiAgent(demo.orgId, "any denials? are the books clean?");
    assert.ok(res.toolsUsed.includes("list_denials"));
    assert.ok(res.toolsUsed.includes("books_health"));
  });

  it("explains policy bands and quiet hours", async () => {
    const demo = store.seedDemoOrg();
    const policy = await runAbiAgent(demo.orgId, "show me the policy bands and ask me above");
    assert.ok(policy.toolsUsed.includes("get_policy"));
    assert.match(policy.answer, /Ask me above|HITL|Per payment/i);
    assert.ok(policy.scratchpad?.lastTopic === "policy" || policy.goto === "policy");

    const quiet = await runAbiAgent(demo.orgId, "are we in quiet hours?");
    assert.ok(quiet.toolsUsed.includes("quiet_hours_status"));
    assert.match(quiet.answer, /quiet/i);
  });

  it("remembers facts and recalls them", async () => {
    const demo = store.seedDemoOrg();
    const saved = await runAbiAgent(demo.orgId, "Remember that Researcher only pays pricing APIs");
    assert.ok(saved.toolsUsed.includes("remember_fact"));
    assert.match(saved.answer, /Saved|Remembered|pricing/i);

    const recalled = await runAbiAgent(demo.orgId, "What do you remember?");
    assert.ok(recalled.toolsUsed.includes("recall_facts"));
    assert.match(recalled.answer, /pricing APIs/i);
  });

  it("recommends next actions from live org state", async () => {
    const demo = store.seedDemoOrg();
    const res = await runAbiAgent(demo.orgId, "What should I do next?");
    assert.ok(res.toolsUsed.includes("recommend_next"));
    assert.match(res.answer, /•/);
    assert.equal(res.intent, "recommend");
  });

  it("compares agents by stipend and spend", async () => {
    const demo = store.seedDemoOrg();
    const res = await runAbiAgent(demo.orgId, "compare our agents");
    assert.ok(res.toolsUsed.includes("compare_agents") || res.toolsUsed.includes("list_agents"));
    assert.match(res.answer, /Researcher|Writer|stipend|spend/i);
  });

  it("binds a named agent into agent_detail", async () => {
    const demo = store.seedDemoOrg();
    const bound = bindAgents(demo.orgId, "How is Researcher doing?");
    assert.ok(bound.some((a) => /researcher/i.test(a.name)));
    assert.equal(classifyIntent("How is Researcher?"), "agent_detail");

    const res = await runAbiAgent(demo.orgId, "How is Researcher?");
    assert.ok(res.toolsUsed.includes("agent_detail"));
    assert.match(res.answer, /Researcher/i);
    assert.match(res.answer, /Stipend|24h spend|Recent outcomes/i);
    assert.ok(res.scratchpad?.agentNames?.some((n) => /researcher/i.test(n)));
  });

  it("explains a denial against policy bands", async () => {
    const demo = store.seedDemoOrg();
    const agents = store.listAgents(demo.orgId);
    const agent = agents[0]!;
    store.addDecision({
      intentId: "int_test_deny",
      orgId: demo.orgId,
      agentId: agent.id,
      outcome: "deny",
      ruleIds: ["per_tx_max"],
      reasons: ["Above per-payment ceiling"],
      tool: "pay",
      amountUsdc: "999.00",
      destination: "api.pricey.example",
      at: new Date().toISOString(),
    });
    const res = await runAbiAgent(demo.orgId, "why was api.pricey.example denied?");
    assert.ok(res.toolsUsed.includes("explain_decision") || res.toolsUsed.includes("lookup_decision"));
    assert.match(res.answer, /api\.pricey\.example|DENY|Band context|per-payment|ask-me/i);
  });

  it("surveys governance seats", async () => {
    const demo = store.seedDemoOrg();
    const res = await runAbiAgent(demo.orgId, "who can approve payments?");
    assert.ok(res.toolsUsed.includes("governance_status"));
    assert.match(res.answer, /guardian|quorum|approve|founding owner/i);
    assert.ok(!res.toolsUsed.includes("recent_spend"), "should not false-positive on payments");
  });

  it("does not treat Researcher as research budget keyword", async () => {
    const demo = store.seedDemoOrg();
    const res = await runAbiAgent(demo.orgId, "How is Researcher?");
    assert.ok(res.toolsUsed.includes("agent_detail"));
    assert.ok(!res.toolsUsed.includes("list_budgets"));
  });

  it("bindEntities pulls amount and destination fragments", () => {
    const demo = store.seedDemoOrg();
    const e = bindEntities(demo.orgId, "Why was $25 to api.pricey.example blocked?");
    assert.equal(e.amountUsdc, "25");
    assert.ok(
      e.destinations.some((d) => /pricey/i.test(d)) || e.destinations.includes("api.pricey.example"),
    );
  });

  it("queues a MaltBook proposal for HITL without posting", async () => {
    const demo = store.seedDemoOrg();
    const res = await runAbiAgent(demo.orgId, "Propose a MaltBook post about our agents");
    assert.ok(res.toolsUsed.includes("propose_external_action"));
    assert.ok(res.externalAction);
    assert.equal(res.externalAction!.platform, "maltbook");
    assert.equal(res.externalAction!.status, "pending");
    assert.match(res.answer, /nothing has been posted/i);

    const approved = resolveExternalProposal(demo.orgId, res.externalAction!.id, true);
    assert.equal(approved?.status, "approved");
    // Still a stub — content unchanged, no browse
    assert.ok(approved?.content);
  });
});

describe("runLlmToolLoop", () => {
  it("returns null when LLM disabled", async () => {
    process.env.ABI_CHAT_LLM = "0";
    process.env.OPENAI_API_KEY = "sk-test";
    const demo = store.seedDemoOrg();
    const res = await runLlmToolLoop(demo.orgId, "how are the agents?");
    assert.equal(res, null);
  });

  it("executes tool_calls from a mocked OpenAI response", async () => {
    process.env.ABI_CHAT_LLM = "1";
    process.env.OPENAI_API_KEY = "sk-test";
    const demo = store.seedDemoOrg();

    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      calls++;
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        messages: { role: string; tool_calls?: unknown[] }[];
      };
      const last = body.messages[body.messages.length - 1];
      if (calls === 1) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [
                    {
                      id: "call_1",
                      type: "function",
                      function: { name: "list_agents", arguments: "{}" },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      // Second round: final answer after tool result
      assert.equal(last?.role, "tool");
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: "assistant",
                content: "You have agents on the roster (LLM).",
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    try {
      const res = await runLlmToolLoop(demo.orgId, "how are the agents?");
      assert.ok(res);
      assert.deepEqual(res!.toolsUsed, ["list_agents"]);
      assert.match(res!.answer, /LLM/);
      assert.equal(res!.via, "llm");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("runAbiAgent prefers LLM when enabled", async () => {
    process.env.ABI_CHAT_LLM = "1";
    process.env.OPENAI_API_KEY = "sk-test";
    const demo = store.seedDemoOrg();
    const originalFetch = globalThis.fetch;
    let n = 0;
    globalThis.fetch = (async () => {
      n++;
      if (n === 1) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  tool_calls: [
                    {
                      id: "c1",
                      type: "function",
                      function: {
                        name: "propose_external_action",
                        arguments: JSON.stringify({
                          platform: "maltbook",
                          action: "post",
                          content: "Hello MaltBook",
                        }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "Queued MaltBook post for your approval." } }],
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    try {
      const res = await runAbiAgent(demo.orgId, "post to MaltBook please");
      assert.equal(res.via, "llm");
      assert.ok(res.toolsUsed.includes("propose_external_action"));
      assert.equal(res.externalAction?.platform, "maltbook");
      assert.equal(res.externalAction?.status, "pending");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
