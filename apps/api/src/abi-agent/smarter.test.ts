/**
 * The "smarter" assistant: language understanding, references to the last
 * list, live notifications + payments context, cross-session recap, honest
 * unknowns — and the two guarantees that must not regress while it got
 * smarter: it never writes money/approval/policy state, and it never shows
 * one organization another organization's data.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "pv-abi-smart-"));
process.env.POLICYVAULT_DB = join(dir, "abi.db");
process.env.POLICYVAULT_ALLOW_BOOTSTRAP = "1";
process.env.ABI_KEY_PEPPER = "test-pepper";
process.env.ABI_CHAT_LLM = "0";

const { store } = await import("../store.js");
const { runAbiAgent } = await import("./index.js");
type Turn = { role: "user" | "assistant"; body: string; meta?: Record<string, unknown> };

after(() => rmSync(dir, { recursive: true, force: true }));

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

function seed(tag: string) {
  const demo = store.seedDemoOrg();
  const dec = (
    id: string,
    agentId: string,
    outcome: "allow" | "deny" | "review",
    amt: string,
    dest: string,
    rule: string,
    min: number,
  ) =>
    store.addDecision({
      intentId: `${tag}_${id}`,
      orgId: demo.orgId,
      agentId,
      outcome,
      ruleIds: [rule],
      reasons: [rule],
      tool: "pay",
      amountUsdc: amt,
      destination: dest,
      at: ago(min),
    });
  dec("a1", demo.researcherAgentId, "allow", "2.50", `weather.${tag}.example`, "within_band", 300);
  dec("d1", demo.researcherAgentId, "deny", "999.00", `pricey.${tag}.example`, "per_tx_max", 60);
  dec("r1", demo.writerAgentId, "review", "15.00", `photos.${tag}.example`, "hitl_above", 10);
  store.createApproval({
    id: `appr_${tag}`,
    orgId: demo.orgId,
    agentId: demo.writerAgentId,
    intentId: `${tag}_r1`,
    tool: "pay",
    amountMicro: 15_000_000n,
    amountUsdc: "15",
    destination: `photos.${tag}.example`,
    idempotencyKey: `k_${tag}`,
    ruleIds: ["hitl_above"],
    reasons: ["Above ask-me-above"],
    status: "pending",
    createdAt: ago(10),
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  });
  store.createNotification({
    orgId: demo.orgId,
    kind: "payment.denied",
    title: `Payment blocked at pricey.${tag}.example`,
    body: "Per-payment ceiling",
    link: "payments",
    severity: "warn",
  });
  return demo;
}

/** Drive a conversation the way the route does (history carried in meta). */
async function converse(orgId: string, msgs: string[], history: Turn[] = []) {
  const out = [];
  for (const m of msgs) {
    const r = await runAbiAgent(orgId, m, history.slice(-24));
    history.push({ role: "user", body: m });
    history.push({
      role: "assistant",
      body: r.answer,
      meta: { toolsUsed: r.toolsUsed, scratchpad: r.scratchpad, intent: r.intent },
    });
    out.push(r);
  }
  return out;
}

/** Everything the assistant must never change. */
function snapshot(orgId: string) {
  return JSON.stringify({
    approvals: store.listApprovals(orgId, "pending", 50).map((a) => [a.id, a.status]),
    policy: JSON.stringify(store.getPolicyTemplate(orgId), (_k, v) =>
      typeof v === "bigint" ? v.toString() : v,
    ),
    balances: [...store.getAccountMap(orgId).entries()].map(([k, v]) => [
      k,
      String(v.balanceMicro),
    ]),
    agents: store.listAgents(orgId).map((a) => [a.id, a.name, a.status]),
    unread: store.countUnreadNotifications(orgId),
    decisions: store.listDecisions(orgId, 500).length,
  });
}

describe("smarter ABI assistant", () => {
  it("understands typos and casual phrasing", async () => {
    const d = seed("typo");
    const [r] = await converse(d.orgId, ["hey um hows the reseacher doing"]);
    assert.ok(r!.toolsUsed.includes("agent_detail"));
    assert.match(r!.answer, /Researcher — active/);
    assert.match(r!.answer, /Reading “reseacher” as “researcher”/);

    const [stuck] = await converse(d.orgId, ["whats stuck waiting on me"]);
    assert.ok(stuck!.toolsUsed.includes("pending_approvals"));
    assert.match(stuck!.answer, /photos\.typo\.example/);
  });

  it("lists recent payments and resolves 'the second one' / 'the last one blocked'", async () => {
    const d = seed("ref");
    const [list, second, blocked] = await converse(d.orgId, [
      "show me recent txns",
      "explain the second one",
      "why was the last one blocked",
    ]);
    assert.deepEqual(list!.toolsUsed, ["recent_payments"]);
    assert.match(list!.answer, /1\. waiting\/reviewed \$15\.00 → photos\.ref\.example/);
    assert.match(list!.answer, /2\. blocked \$999\.00 → pricey\.ref\.example/);
    assert.match(second!.answer, /DENY \$999\.00 → pricey\.ref\.example/);
    assert.match(second!.answer, /per-payment ceiling/);
    assert.match(blocked!.answer, /DENY \$999\.00/);
    assert.match(blocked!.answer, /What this means: the agent was told no/);
  });

  it("follows up on 'that agent' style references and scopes payments to a named agent", async () => {
    const d = seed("agent");
    const [, writer, mine] = await converse(d.orgId, [
      "how is researcher",
      "and the writer?",
      "recent payments by writer",
    ]);
    assert.match(writer!.answer, /Writer — active/);
    assert.ok(!writer!.toolsUsed.includes("org_summary"), "follow-up should not re-survey");
    assert.match(mine!.answer, /Recent payments · Writer/);
    const block = mine!.answer.split("\n\n").find((b) => b.startsWith("Recent payments")) ?? "";
    assert.match(block, /photos\.agent\.example/);
    assert.doesNotMatch(
      block,
      /pricey\.agent\.example/,
      "Researcher's payment leaked into Writer's list",
    );
  });

  it("reads notifications without marking them read", async () => {
    const d = seed("notif");
    const before = store.countUnreadNotifications(d.orgId);
    const [r] = await converse(d.orgId, ["any new notifications?"]);
    assert.ok(r!.toolsUsed.includes("notifications_digest"));
    assert.match(r!.answer, /Payment blocked at pricey\.notif\.example \(unread\)/);
    assert.equal(store.countUnreadNotifications(d.orgId), before);
  });

  it("never acts: approve / pay / policy / freeze / delete requests change nothing", async () => {
    const d = seed("nowrite");
    const before = snapshot(d.orgId);
    const asks = [
      "approve it",
      "please approve all pending payments",
      "deny the writer payment",
      "send $50 to pricey.nowrite.example",
      "transfer 10 usdc to the writer",
      "raise the daily limit to 500",
      "turn off quiet hours",
      "freeze researcher",
      "delete the writer agent",
      "mark all notifications read",
    ];
    const res = await converse(d.orgId, asks);
    for (const [i, r] of res.entries()) {
      assert.equal(r.intent, "action_request", asks[i]);
      assert.match(r.answer, /^I can't .* from chat/, asks[i]);
      for (const t of r.toolsUsed) {
        assert.ok(!["remember_fact", "forget_fact"].includes(t), `${asks[i]} used ${t}`);
      }
    }
    assert.equal(snapshot(d.orgId), before);
    assert.equal(store.listApprovals(d.orgId, "pending", 50)[0]?.status, "pending");
  });

  it("answers honestly when it has no data or doesn't understand", async () => {
    const d = seed("honest");
    const [credit, gibberish] = await converse(d.orgId, ["what's my credit score", "blorp fizzle"]);
    assert.equal(credit!.intent, "out_of_scope");
    assert.match(credit!.answer, /I don't have data on credit scores/);
    assert.doesNotMatch(credit!.answer.split("\n\n")[0]!, /\$\d/);
    assert.equal(gibberish!.intent, "unknown");
    assert.match(gibberish!.answer, /I'm not sure what you're asking/);
    assert.deepEqual(gibberish!.toolsUsed, []);
  });

  it("offers answerable quick replies, never actions", async () => {
    const d = seed("chips");
    const res = await converse(d.orgId, [
      "hi",
      "how is writer",
      "show recent payments",
      "approve it",
    ]);
    for (const r of res) {
      assert.ok(r.suggestions && r.suggestions.length > 0 && r.suggestions.length <= 4);
      for (const s of r.suggestions!) {
        assert.doesNotMatch(s, /^(approve|deny|send|pay|transfer|raise|freeze|delete)\b/i, s);
      }
    }
    assert.ok(res[2]!.suggestions!.includes("Explain the last one"));
  });

  it("applies a saved 'short answers' preference", async () => {
    const d = seed("brief");
    const [, r] = await converse(d.orgId, [
      "remember that I prefer short answers",
      "how is researcher",
    ]);
    assert.match(r!.answer, /Researcher — active/);
    assert.doesNotMatch(r!.answer, /Suggested next/);
  });

  it("recaps earlier sessions from durable history, per org", async () => {
    const a = seed("recapA");
    const b = seed("recapB");
    // An earlier exchange, stored the way the route stores it.
    store.appendChatMessage({
      orgId: a.orgId,
      role: "user",
      kind: "text",
      body: "how is researcher",
    });
    store.appendChatMessage({
      orgId: a.orgId,
      role: "assistant",
      kind: "text",
      body: "Researcher — active",
      meta: { intent: "agent_detail", scratchpad: { agentNames: ["Researcher"] } },
    });
    const [r] = await converse(a.orgId, ["what did we talk about last time?"]);
    assert.equal(r!.intent, "recap");
    assert.match(r!.answer, /Agents discussed: Researcher/);
    assert.match(r!.answer, /how is researcher/);
    const [other] = await converse(b.orgId, ["what did we talk about last time?"]);
    assert.match(other!.answer, /first conversation/);
  });

  it("keeps every answer inside the caller's org", async () => {
    const a = seed("orgalpha");
    store.renameAgent(a.researcherAgentId, "AlphaSecretBot");
    store.appendChatMessage({
      orgId: a.orgId,
      role: "user",
      kind: "text",
      body: "alpha private question",
    });
    store.addAbiMemory(a.orgId, "alpha secret note");
    const b = seed("orgbeta");
    const asks = [
      "hi",
      "how is alphasecretbot",
      "how is alphasecretbt",
      "show recent payments",
      "explain the second one",
      "why was the last one blocked",
      "any new notifications?",
      "what did we talk about last time?",
      "what's waiting on me",
      "who did we pay",
      "what should i do next",
      "approve it",
    ];
    const res = await converse(b.orgId, asks);
    for (const [i, r] of res.entries()) {
      // Case-sensitive: the guardian's own (lower-case) words may be echoed back;
      // org A's real agent name, destinations, chat and notes must never appear.
      assert.doesNotMatch(r.answer, /orgalpha|AlphaSecretBot|alpha private|alpha secret/, asks[i]);
      for (const s of r.suggestions ?? []) assert.doesNotMatch(s, /alpha/i);
    }
  });
});
