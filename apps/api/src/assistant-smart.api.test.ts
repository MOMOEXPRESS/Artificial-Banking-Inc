/**
 * The smarter assistant through the real guardian chat route: quick replies
 * are returned and persisted, a request to approve over chat leaves the
 * approval pending, and one org's conversation never surfaces in another's.
 */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "pv-smart-"));
process.env.POLICYVAULT_DB = join(dir, "smart.db");
process.env.ABI_KEY_PEPPER = "test-pepper";
process.env.ABI_NO_LISTEN = "1";
process.env.POLICYVAULT_MOCK_TRANSFER = "1";
process.env.ABI_CHAT_LLM = "0";
process.env.POLICYVAULT_ALLOW_BOOTSTRAP = "0";

const { store } = await import("./store.js");
const { app } = await import("./index.js");

let base = "";
let server: ReturnType<typeof app.listen>;
before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server?.close();
  rmSync(dir, { recursive: true, force: true });
});

type ChatRes = {
  reply: { body: string; meta?: { suggestions?: string[]; intent?: string } };
  suggestions: string[];
  messages: { role: string; body: string }[];
};

async function chat(key: string, message: string): Promise<ChatRes> {
  const res = await fetch(`${base}/v1/guardian/chat`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ message }),
  });
  assert.equal(res.status, 200);
  return (await res.json()) as ChatRes;
}

describe("smarter assistant over HTTP", () => {
  it("returns and stores quick replies; 'approve it' leaves the approval pending", async () => {
    const org = store.createOrg("Smart A", 10_000_000n);
    const agent = store.createAgent(org.id, "Courier");
    const now = new Date().toISOString();
    store.addDecision({
      intentId: "int_smart_r1",
      orgId: org.id,
      agentId: agent.agentId,
      outcome: "review",
      ruleIds: ["hitl_above"],
      reasons: ["Above ask-me-above"],
      tool: "pay",
      amountUsdc: "12.00",
      destination: "maps.smart.example",
      at: now,
    });
    store.createApproval({
      id: "appr_smart_1",
      orgId: org.id,
      agentId: agent.agentId,
      intentId: "int_smart_r1",
      tool: "pay",
      amountMicro: 12_000_000n,
      amountUsdc: "12",
      destination: "maps.smart.example",
      idempotencyKey: "k_smart_1",
      ruleIds: ["hitl_above"],
      reasons: ["Above ask-me-above"],
      status: "pending",
      createdAt: now,
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });

    const hi = await chat(org.guardianKey, "hey abi whats going on");
    assert.ok(hi.suggestions.length > 0);
    assert.deepEqual(hi.reply.meta?.suggestions, hi.suggestions);

    const approve = await chat(org.guardianKey, "ok approve it");
    assert.match(approve.reply.body, /I can't approve payments from chat/);
    assert.equal(approve.reply.meta?.intent, "action_request");
    assert.equal(store.listApprovals(org.id, "pending", 10)[0]?.id, "appr_smart_1");

    const couriers = await chat(org.guardianKey, "hows the courrier doing");
    assert.match(couriers.reply.body, /Courier — active/);
  });

  it("never shows one org's conversation or agents to another", async () => {
    const a = store.createOrg("Smart Iso A", 10_000_000n);
    store.createAgent(a.id, "Vanguardian");
    const b = store.createOrg("Smart Iso B", 10_000_000n);
    await chat(a.guardianKey, "how is vanguardian doing with the zebra project");
    for (const q of ["what did we talk about last time?", "how is vanguardian", "list agents"]) {
      const r = await chat(b.guardianKey, q);
      assert.doesNotMatch(r.reply.body, /Vanguardian|zebra/, q);
      assert.ok(!r.messages.some((m) => /zebra/.test(m.body)));
    }
  });
});
