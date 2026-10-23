/**
 * Every refusal explains itself with numbers, links a re-proposal to the
 * intent it supersedes, and carries a verifiable signed receipt.
 */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "pv-dnum-"));
process.env.POLICYVAULT_DB = join(dir, "dnum.db");
process.env.ABI_KEY_PEPPER = "test-pepper";
process.env.ABI_NO_LISTEN = "1";
process.env.POLICYVAULT_MOCK_TRANSFER = "1";
process.env.ABI_CHAT_LLM = "0";
process.env.ABI_CHAT_AGENT = "0";
process.env.POLICYVAULT_ALLOW_BOOTSTRAP = "0";

const { store } = await import("./store.js");
const { app } = await import("./index.js");
const { resolveApproval, id } = await import("./engine.js");

const PAYEE = "0x2222222222222222222222222222222222222222";
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

function fixture() {
  const org = store.createOrg("Numbers Co", 1_000_000_000n);
  const agent = store.createAgent(org.id, "Spender");
  const budget = store.createDepartment(org.id, "Budget");
  assert.equal(store.assignAgentBudget(org.id, agent.agentId, budget.id), "ok");
  const t = store.getPolicyTemplate(org.id);
  store.setPolicyTemplate(org.id, {
    ...t,
    addressAllowlist: [PAYEE],
    perTxMaxMicro: 100_000_000n,
    dailyMaxMicro: 150_000_000n,
    hitlAboveMicro: 50_000_000n,
    newCounterpartyCooldownHours: 0,
    hitlCategories: [],
  });
  store.addKnownCounterparty(org.id, PAYEE);
  store.applyEntries(org.id, [
    {
      id: id("j"),
      orgId: org.id,
      memo: "seed",
      createdAt: new Date().toISOString(),
      lines: [
        { accountId: `org:${org.id}:available`, deltaMicro: -500_000_000n },
        { accountId: `dept:${budget.id}:available`, deltaMicro: 500_000_000n },
      ],
    },
  ]);
  return { org, agent };
}

type Body = {
  intentId?: string;
  outcome?: string;
  ruleIds?: string[];
  approvalId?: string;
  limits?: { ruleId: string; attempted: string; cap: string; used?: string; remaining: string };
  supersedes?: string;
  receipt?: { alg: string; signature: string; body: Record<string, unknown> };
  error?: { code?: string; message?: string };
};

async function pay(key: string, body: Record<string, unknown>) {
  const res = await fetch(`${base}/v1/agent/pay`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Body };
}

let n = 0;
const key = () => `idem-key-${++n}-${Date.now()}`;

describe("denial numbers, supersedes and signed receipts", () => {
  it("a per-payment cap denial carries attempted / cap / remaining and a valid receipt", async () => {
    const { org, agent } = fixture();
    const r = await pay(agent.apiKey, {
      amountUsdc: "120",
      destination: PAYEE,
      idempotencyKey: key(),
    });
    assert.equal(r.status, 403);
    assert.deepEqual(r.body.ruleIds, ["per_tx_max"]);
    assert.deepEqual(
      { ...r.body.limits },
      {
        ruleId: "per_tx_max",
        unit: "usdc",
        attempted: "120",
        cap: "100",
        remaining: "100",
        window: "per_payment",
      },
    );
    assert.equal(r.body.receipt?.alg, "HMAC-SHA256");
    assert.equal(r.body.receipt?.body.amountUsdc, "120");
    assert.equal(r.body.receipt?.body.destination, PAYEE);
    const stored = store.getDecision(org.id, r.body.intentId!);
    assert.equal((stored?.limits as { cap?: string } | undefined)?.cap, "100");

    const verify = await fetch(`${base}/v1/agent/decision-receipts/verify`, {
      method: "POST",
      headers: { authorization: `Bearer ${agent.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ receipt: r.body.receipt }),
    });
    assert.deepEqual(await verify.json(), { valid: true });
    const forged = structuredClone(r.body.receipt!);
    forged.body.amountUsdc = "1";
    const bad = await fetch(`${base}/v1/guardian/decision-receipts/verify`, {
      method: "POST",
      headers: { authorization: `Bearer ${org.guardianKey}`, "content-type": "application/json" },
      body: JSON.stringify({ receipt: forged }),
    });
    assert.deepEqual(await bad.json(), { valid: false, reason: "bad_signature" });
  });

  it("a daily cap denial says how much was used and what remains", async () => {
    const { agent } = fixture();
    assert.equal(
      (await pay(agent.apiKey, { amountUsdc: "40", destination: PAYEE, idempotencyKey: key() }))
        .status,
      200,
    );
    assert.equal(
      (await pay(agent.apiKey, { amountUsdc: "40", destination: PAYEE, idempotencyKey: key() }))
        .status,
      200,
    );
    const r = await pay(agent.apiKey, {
      amountUsdc: "80",
      destination: PAYEE,
      idempotencyKey: key(),
    });
    assert.equal(r.status, 403);
    assert.deepEqual(r.body.ruleIds, ["daily_max"]);
    assert.equal(r.body.limits?.cap, "150");
    assert.equal(r.body.limits?.used, "80");
    assert.equal(r.body.limits?.remaining, "70");
  });

  it("a frozen agent's refusal still carries a receipt", async () => {
    const { agent } = fixture();
    store.setAgentStatus(agent.agentId, "frozen");
    const r = await pay(agent.apiKey, {
      amountUsdc: "1",
      destination: PAYEE,
      idempotencyKey: key(),
    });
    assert.equal(r.status, 403);
    assert.deepEqual(r.body.ruleIds, ["agent_frozen"]);
    assert.ok(r.body.receipt?.signature);
  });

  it("a re-proposal links to the refused intent it supersedes, and only to a refused one of its own", async () => {
    const { org, agent } = fixture();
    const refused = await pay(agent.apiKey, {
      amountUsdc: "120",
      destination: PAYEE,
      idempotencyKey: key(),
    });
    assert.equal(refused.status, 403);
    const retry = await pay(agent.apiKey, {
      amountUsdc: "20",
      destination: PAYEE,
      idempotencyKey: key(),
      supersedes: refused.body.intentId,
    });
    assert.equal(retry.status, 200);
    assert.equal(retry.body.receipt?.body.supersedes, refused.body.intentId);
    const decisions = store.listDecisions(org.id, 10);
    assert.ok(decisions.some((d) => d.supersedes === refused.body.intentId));

    // Cannot supersede an allowed intent.
    const notRefused = await pay(agent.apiKey, {
      amountUsdc: "1",
      destination: PAYEE,
      idempotencyKey: key(),
      supersedes: retry.body.intentId,
    });
    assert.equal(notRefused.status, 400);

    // Cannot supersede another agent's intent.
    const other = store.createAgent(org.id, "Other");
    const theirs = await pay(other.apiKey, {
      amountUsdc: "1",
      destination: PAYEE,
      idempotencyKey: key(),
      supersedes: refused.body.intentId,
    });
    assert.equal(theirs.status, 400);

    // Unknown intent.
    const unknown = await pay(agent.apiKey, {
      amountUsdc: "1",
      destination: PAYEE,
      idempotencyKey: key(),
      supersedes: "int_does_not_exist",
    });
    assert.equal(unknown.status, 400);
  });

  it("the post-approval re-check refusal carries the numbers in the approval result", async () => {
    const { org, agent } = fixture();
    const parked = await pay(agent.apiKey, {
      amountUsdc: "60",
      destination: PAYEE,
      idempotencyKey: key(),
    });
    assert.equal(parked.status, 202);
    assert.ok(parked.body.receipt?.signature, "a review decision is signed too");
    // While parked, other spend uses up the daily headroom.
    store.recordPay(agent.agentId, 120_000_000n, org.id, { destination: PAYEE });
    const outcome = await resolveApproval(org.id, parked.body.approvalId!, true, "owner", "owner");
    assert.equal(outcome.kind, "resolved");
    const result = outcome.kind === "resolved" ? (outcome.approval.result as Body) : {};
    assert.deepEqual(result.ruleIds, ["daily_max"]);
    assert.equal(result.limits?.cap, "150");
    assert.equal(result.limits?.used, "120");
    assert.equal(result.limits?.remaining, "30");
    assert.equal(result.receipt?.body.outcome, "deny");
    const decision = store.getDecision(org.id, parked.body.intentId!);
    assert.equal((decision?.limits as { remaining?: string } | undefined)?.remaining, "30");
  });

  it("simulate returns JSON-safe numbers", async () => {
    const { agent } = fixture();
    const res = await fetch(`${base}/v1/agent/simulate`, {
      method: "POST",
      headers: { authorization: `Bearer ${agent.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ tool: "pay", amountUsdc: "120", destination: PAYEE }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as Body;
    assert.equal(body.limits?.cap, "100");
  });
});
