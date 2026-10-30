/**
 * Stale approvals are cancelled, not just reported ("dead, not old").
 *
 * A pending approval binds to the rules it was parked under: the policy
 * revision and a hash of the agent's effective caps, budgets and allowlists.
 * When either changes, the approval ends as `cancelled_stale`: the reasons are
 * recorded, nothing is sent, `approval.resolved` fires once with resolver
 * `system:stale_cancel`, and the agent is told to re-request.
 *
 * No chain, no spend: mock transfer rail only.
 */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "pv-stale-"));
process.env.POLICYVAULT_DB = join(dir, "stale.db");
process.env.ABI_KEY_PEPPER = "test-pepper";
process.env.ABI_NO_LISTEN = "1";
process.env.POLICYVAULT_MOCK_TRANSFER = "1";
process.env.ABI_CHAT_LLM = "0";
process.env.ABI_CHAT_AGENT = "0";
process.env.POLICYVAULT_ALLOW_BOOTSTRAP = "0";

const { store } = await import("./store.js");
const { app } = await import("./index.js");
const engine = await import("./engine.js");
const { id, sweepStaleApprovals, STALE_CANCEL_RESOLVER } = engine;
const { JOBS } = await import("./jobs/scheduler.js");

const PAYEE = "0x3333333333333333333333333333333333333333";

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
async function call(
  path: string,
  key: string,
  body?: Record<string, unknown>,
  method = body ? "POST" : "GET",
): Promise<{ status: number; body: Json }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    ...(body && { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: await res.json() };
}

let n = 0;
const key = () => `stale-key-${++n}-${Date.now()}`;

function fixture() {
  const org = store.createOrg(`Stale Co ${++n}`, 1_000_000_000n);
  const agent = store.createAgent(org.id, "Spender");
  const budget = store.createDepartment(org.id, "Budget");
  assert.equal(store.assignAgentBudget(org.id, agent.agentId, budget.id), "ok");
  const t = store.getPolicyTemplate(org.id);
  store.setPolicyTemplate(org.id, {
    ...t,
    addressAllowlist: [PAYEE],
    perTxMaxMicro: 100_000_000n,
    dailyMaxMicro: 300_000_000n,
    hitlAboveMicro: 50_000_000n,
    newCounterpartyCooldownHours: 0,
    hitlCategories: [],
    maxPaysPerMinute: 100,
    maxPaysPerHour: 1000,
    quietHours: undefined,
    automation: [],
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
  // Webhook deliveries are recorded in the DB, so events can be read back.
  store.createWebhook(org.id, "abi://demo-inbox");
  const balances = () => {
    const m = store.getAccountMap(org.id);
    return {
      available: m.get(`dept:${budget.id}:available`)?.balanceMicro ?? 0n,
      held: m.get(`dept:${budget.id}:held`)?.balanceMicro ?? 0n,
      external: m.get(`org:${org.id}:external`)?.balanceMicro ?? 0n,
    };
  };
  return { org, agent, budget, balances };
}

function events(orgId: string, event: string): Record<string, Json>[] {
  return store
    .listDeliveries(orgId, 500)
    .filter((d) => d.event === event)
    .map((d) => (d.payload as { data: Record<string, Json> }).data);
}

/** Park a $60 payment (above the $50 review threshold). */
async function park(agentKey: string, idem = key()) {
  const r = await call("/v1/agent/pay", agentKey, {
    amountUsdc: "60",
    destination: PAYEE,
    idempotencyKey: idem,
  });
  assert.equal(r.status, 202, JSON.stringify(r.body));
  return { approvalId: r.body.approvalId as string, intentId: r.body.intentId as string, idem };
}

function staleEvents(orgId: string, approvalId: string) {
  return events(orgId, "approval.resolved").filter(
    (e) => e.approvalId === approvalId && e.status === "cancelled_stale",
  );
}

describe("stale approvals are cancelled automatically", () => {
  it("a fresh approval is not stale, and other payments settling do not make it stale", async () => {
    const f = fixture();
    const parked = await park(f.agent.apiKey);
    // An unrelated payment settles: spend counters and balances move.
    const small = await call("/v1/agent/pay", f.agent.apiKey, {
      amountUsdc: "5",
      destination: PAYEE,
      idempotencyKey: key(),
    });
    assert.equal(small.status, 200, JSON.stringify(small.body));
    assert.equal(sweepStaleApprovals(f.org.id), 0);
    const read = await call(`/v1/agent/approvals/${parked.approvalId}`, f.agent.apiKey);
    assert.equal(read.body.approval.status, "pending");
    assert.deepEqual(read.body.approval.stale, []);
    assert.match(read.body.approval.rulesHash, /^r2:[0-9a-f]{64}$/);
    // And it still executes on a guardian's yes.
    const yes = await call(
      `/v1/guardian/approvals/${parked.approvalId}/resolve`,
      f.org.guardianKey,
      {
        approve: true,
      },
    );
    assert.equal(yes.status, 200, JSON.stringify(yes.body));
    assert.equal(store.getApproval(parked.approvalId, f.org.id)?.status, "approved");
  });

  it("a policy change cancels every pending approval at once, and no funds move", async () => {
    const f = fixture();
    const a = await park(f.agent.apiKey);
    const b = await park(f.agent.apiKey);
    const before = f.balances();

    // Lower the per-payment cap through the guardian API.
    const changed = await call("/v1/guardian/policy", f.org.guardianKey, { perTxMaxUsdc: "80" });
    assert.equal(changed.status, 200, JSON.stringify(changed.body));

    for (const p of [a, b]) {
      const row = store.getApproval(p.approvalId, f.org.id)!;
      assert.equal(row.status, "cancelled_stale", "cancelled at the moment of the change");
      assert.equal(row.resolvedBy, STALE_CANCEL_RESOLVER);
      assert.ok(row.staleReasons?.includes("policy_revision_changed"));
      assert.ok(row.staleReasons?.includes("rules_hash_changed"));
      assert.equal(store.getSettlementForOrg(f.org.id, p.intentId), undefined, "never sent");
    }
    assert.deepEqual(f.balances(), before, "no hold, no spend, nothing external");
  });

  it("emits approval.resolved once with status cancelled_stale and the reasons", async () => {
    const f = fixture();
    const parked = await park(f.agent.apiKey);
    store.setPolicyTemplate(f.org.id, { ...store.getPolicyTemplate(f.org.id) }, "edit");
    const evs = staleEvents(f.org.id, parked.approvalId);
    assert.equal(evs.length, 1);
    const e = evs[0];
    assert.equal(e.resolvedBy, "system:stale_cancel");
    assert.equal(e.intentId, parked.intentId);
    assert.deepEqual(e.ruleIds, ["approval_stale"]);
    assert.ok(e.staleReasons.includes("policy_revision_changed"));
    assert.equal(e.denial.rule_code, "approval_stale");
    assert.equal(e.denial.payment_state, "cancelled_not_sent");
    assert.equal(e.denial.next_step.action, "re_request");
    assert.equal(e.denial.charged_usdc, "0");
  });

  it("an agent-policy override change cancels on the rules hash alone", async () => {
    const f = fixture();
    const parked = await park(f.agent.apiKey);
    const r = await call(
      `/v1/guardian/agents/${f.agent.agentId}/policy`,
      f.org.guardianKey,
      { dailyMaxUsdc: "200" },
      "PUT",
    );
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const row = store.getApproval(parked.approvalId, f.org.id)!;
    assert.equal(row.status, "cancelled_stale");
    assert.deepEqual(row.staleReasons, ["rules_hash_changed"]);
  });

  it("a guardian vote on a stale approval is refused and executes nothing", async () => {
    const f = fixture();
    const parked = await park(f.agent.apiKey);
    const before = f.balances();
    // Stale, but not yet swept (as if the change hook had been missed).
    store.setApprovalPolicyRevisionForTests(parked.approvalId, "v-older");
    const vote = await call(
      `/v1/guardian/approvals/${parked.approvalId}/resolve`,
      f.org.guardianKey,
      { approve: true },
    );
    assert.equal(vote.status, 409, JSON.stringify(vote.body));
    assert.equal(vote.body.error.code, "APPROVAL_STALE");
    assert.equal(vote.body.error.rule_code, "approval_stale");
    assert.deepEqual(vote.body.staleReasons, ["policy_revision_changed"]);
    assert.equal(vote.body.denial.next_step.action, "re_request");
    assert.equal(vote.body.approval.status, "cancelled_stale");
    assert.equal(store.listVotes(parked.approvalId).length, 0, "the vote was not recorded");

    // Voting again (approve or deny) gets the same refusal.
    const again = await call(
      `/v1/guardian/approvals/${parked.approvalId}/resolve`,
      f.org.guardianKey,
      { approve: true },
    );
    assert.equal(again.status, 409);
    assert.equal(again.body.error.rule_code, "approval_stale");

    assert.equal(store.getSettlementForOrg(f.org.id, parked.intentId), undefined);
    assert.deepEqual(f.balances(), before);
    assert.equal(staleEvents(f.org.id, parked.approvalId).length, 1);
  });

  it("the scheduled sweep cancels what the change hook missed", async () => {
    const f = fixture();
    const parked = await park(f.agent.apiKey);
    store.setApprovalPolicyRevisionForTests(parked.approvalId, "v-older");
    const job = JOBS.find((j) => j.name === "approval-expiry")!;
    await job.run();
    assert.equal(store.getApproval(parked.approvalId, f.org.id)?.status, "cancelled_stale");
  });

  it("is idempotent: repeat sweeps and later policy changes emit nothing new", async () => {
    const f = fixture();
    const parked = await park(f.agent.apiKey);
    store.setPolicyTemplate(f.org.id, { ...store.getPolicyTemplate(f.org.id) }, "edit 1");
    const first = store.getApproval(parked.approvalId, f.org.id)!;
    assert.equal(sweepStaleApprovals(f.org.id), 0);
    assert.equal(sweepStaleApprovals(), 0);
    store.setPolicyTemplate(f.org.id, { ...store.getPolicyTemplate(f.org.id) }, "edit 2");
    const later = store.getApproval(parked.approvalId, f.org.id)!;
    assert.equal(later.resolvedAt, first.resolvedAt, "cancelled exactly once");
    assert.deepEqual(later.staleReasons, first.staleReasons);
    assert.equal(staleEvents(f.org.id, parked.approvalId).length, 1);
    assert.equal(engine.cancelStaleApproval(later, ["policy_revision_changed"]), false);
  });

  it("the agent reads cancelled_stale with reasons and is told to re-request", async () => {
    const f = fixture();
    const parked = await park(f.agent.apiKey);
    store.setPolicyTemplate(f.org.id, { ...store.getPolicyTemplate(f.org.id) }, "edit");

    const rec = await call(`/v1/agent/approvals/${parked.approvalId}`, f.agent.apiKey);
    assert.equal(rec.status, 200);
    assert.equal(rec.body.approval.status, "cancelled_stale");
    assert.ok(rec.body.approval.stale.includes("policy_revision_changed"));
    assert.equal(rec.body.approval.cancelled.reason, "stale");
    assert.equal(rec.body.approval.cancelled.by, "system:stale_cancel");
    assert.equal(rec.body.approval.cancelled.rule_code, "approval_stale");
    assert.equal(rec.body.approval.cancelled.next_step, "re_request");
    assert.equal(rec.body.approval.approver.resolvedBy, "system:stale_cancel");

    const status = await call(`/v1/agent/intents/${parked.intentId}/status`, f.agent.apiKey);
    assert.equal(status.body.state, "cancelled_stale");
    assert.equal(status.body.terminal, true);

    // Same key replays the cancellation; it never re-parks under old rules.
    const replay = await call("/v1/agent/pay", f.agent.apiKey, {
      amountUsdc: "60",
      destination: PAYEE,
      idempotencyKey: parked.idem,
    });
    assert.equal(replay.status, 409, JSON.stringify(replay.body));
    assert.equal(replay.body.error.rule_code, "approval_stale");
    assert.equal(replay.body.denial.next_step.action, "re_request");
    assert.equal(store.listApprovals(f.org.id).length, 1, "no second approval parked");

    // A re-request with a new key is checked against the current rules.
    const again = await call("/v1/agent/pay", f.agent.apiKey, {
      amountUsdc: "60",
      destination: PAYEE,
      idempotencyKey: key(),
    });
    assert.equal(again.status, 202, JSON.stringify(again.body));
    assert.notEqual(again.body.approvalId, parked.approvalId);
  });
});
