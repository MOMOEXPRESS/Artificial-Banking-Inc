/**
 * Oct 24 list, item 1: structured refusals, self-approval, approval expiry,
 * x402 session budgets, fail-closed evaluation, and inflows never growing
 * limits. Everything runs on the mock rail — no chain, no spend.
 */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "pv-refusals-"));
process.env.POLICYVAULT_DB = join(dir, "refusals.db");
process.env.ABI_KEY_PEPPER = "test-pepper";
process.env.ABI_NO_LISTEN = "1";
process.env.POLICYVAULT_MOCK_TRANSFER = "1";
process.env.ABI_CHAT_LLM = "0";
process.env.ABI_CHAT_AGENT = "0";
process.env.POLICYVAULT_ALLOW_BOOTSTRAP = "0";
// A fixed, non-default window so the test proves the setting is honoured.
process.env.APPROVAL_TTL_MINUTES = "7";

const { store } = await import("./store.js");
const { app } = await import("./index.js");
const engine = await import("./engine.js");
const { id, resolveApproval, rulesFor, approvalTtlMinutes, sweepApprovalExpiry } = engine;

const PAYEE = "0x3333333333333333333333333333333333333333";
const STRANGER = "0x4444444444444444444444444444444444444444";
const VENDOR = "api.openai.com";

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

type Denial = {
  rule_code: string;
  payment_state: string;
  charged_usdc: string;
  next_step: { action: string; approval_id?: string; max_amount_usdc?: string; window?: string };
  numbers?: { attempted: string; cap: string; used?: string; remaining: string; window?: string };
};
type Body = {
  intentId?: string;
  outcome?: string;
  approvalId?: string;
  ruleIds?: string[];
  replayed?: boolean;
  error?: { code?: string; rule_code?: string; message?: string };
  limits?: { ruleId: string; cap: string; remaining: string };
  denial?: Denial;
  approval?: { id?: string; status?: string; resolvedBy?: string; expiresAt?: string };
  sessionKey?: { id: string; token: string; x402BudgetUsdc?: string; x402SpentUsdc?: string };
};

async function call(
  path: string,
  key: string,
  body?: Record<string, unknown>,
  method = "POST",
): Promise<{ status: number; body: Body }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    ...(body && { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: (await res.json()) as Body };
}

let n = 0;
const key = () => `refusal-key-${++n}-${Date.now()}`;

function fixture(opts: { hitlAboveUsdc?: number } = {}) {
  const org = store.createOrg(`Refusals Co ${++n}`, 1_000_000_000n);
  const agent = store.createAgent(org.id, "Spender");
  const peer = store.createAgent(org.id, "Peer");
  const budget = store.createDepartment(org.id, "Budget");
  assert.equal(store.assignAgentBudget(org.id, agent.agentId, budget.id), "ok");
  assert.equal(store.assignAgentBudget(org.id, peer.agentId, budget.id), "ok");
  const t = store.getPolicyTemplate(org.id);
  store.setPolicyTemplate(org.id, {
    ...t,
    addressAllowlist: [PAYEE],
    vendorAllowlist: [VENDOR],
    perTxMaxMicro: 100_000_000n,
    dailyMaxMicro: 150_000_000n,
    hitlAboveMicro: BigInt(opts.hitlAboveUsdc ?? 50) * 1_000_000n,
    newCounterpartyCooldownHours: 0,
    hitlCategories: [],
    maxPaysPerMinute: 100,
    maxPaysPerHour: 1000,
    quietHours: undefined,
    automation: [],
  });
  store.addKnownCounterparty(org.id, PAYEE);
  store.addKnownCounterparty(org.id, VENDOR);
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
  return { org, agent, peer, budget };
}

function budgetBalance(orgId: string, budgetId: string): bigint {
  return store.getAccountMap(orgId).get(`dept:${budgetId}:available`)?.balanceMicro ?? 0n;
}

function events(orgId: string, event: string): Record<string, unknown>[] {
  return store
    .listDeliveries(orgId, 200)
    .filter((d) => d.event === event)
    .map((d) => (d.payload as { data: Record<string, unknown> }).data);
}

/** Park a $60 payment (above the $50 review threshold). */
async function park(agentKey: string) {
  const r = await call("/v1/agent/pay", agentKey, {
    amountUsdc: "60",
    destination: PAYEE,
    idempotencyKey: key(),
  });
  assert.equal(r.status, 202, JSON.stringify(r.body));
  assert.ok(r.body.approvalId);
  return r.body;
}

describe("structured refusals", () => {
  it("a parked payment says awaiting_approval with the approval to poll", async () => {
    const { agent } = fixture();
    const parked = await park(agent.apiKey);
    assert.equal(parked.denial?.payment_state, "awaiting_approval");
    assert.equal(parked.denial?.rule_code, "hitl_above");
    assert.equal(parked.denial?.next_step.action, "check_status");
    assert.equal(parked.denial?.next_step.approval_id, parked.approvalId);
    assert.equal(parked.denial?.charged_usdc, "0");
    // Backward-compatible fields are still there.
    assert.equal(parked.error?.code, "NEEDS_APPROVAL");
    assert.deepEqual(parked.ruleIds, ["hitl_above"]);
  });

  it("refusing the same amount to the same payee twice gives the same rule code and no charge", async () => {
    const { org, agent, budget } = fixture();
    const before = budgetBalance(org.id, budget.id);
    const spentBefore = store.spentLast24h(agent.agentId);
    const shapes: Denial[] = [];
    const intents: string[] = [];
    for (let i = 0; i < 2; i++) {
      const r = await call("/v1/agent/pay", agent.apiKey, {
        amountUsdc: "120",
        destination: PAYEE,
        idempotencyKey: key(), // a fresh key each time: a real second attempt
      });
      assert.equal(r.status, 403);
      assert.equal(r.body.error?.code, "POLICY_DENIED");
      assert.equal(r.body.error?.rule_code, "per_tx_max");
      assert.deepEqual(r.body.ruleIds, ["per_tx_max"]);
      assert.ok(r.body.denial);
      shapes.push(r.body.denial);
      intents.push(r.body.intentId!);
    }
    assert.deepEqual(shapes[0], shapes[1], "identical refusal both times");
    assert.equal(shapes[0].rule_code, "per_tx_max");
    assert.equal(shapes[0].payment_state, "not_sent");
    assert.equal(shapes[0].charged_usdc, "0");
    assert.equal(shapes[0].next_step.action, "lower_amount");
    assert.equal(shapes[0].next_step.max_amount_usdc, "100");
    assert.deepEqual(
      { attempted: shapes[0].numbers?.attempted, cap: shapes[0].numbers?.cap },
      { attempted: "120", cap: "100" },
    );
    // No charge: nothing held, nothing settled, no cap headroom consumed.
    assert.equal(budgetBalance(org.id, budget.id), before);
    assert.equal(store.spentLast24h(agent.agentId), spentBefore);
    for (const intentId of intents) assert.equal(store.getSettlement(intentId), undefined);
  });

  it("an off-allowlist payee is refused the same way twice", async () => {
    const { agent } = fixture();
    const codes: string[] = [];
    for (let i = 0; i < 2; i++) {
      const r = await call("/v1/agent/pay", agent.apiKey, {
        amountUsdc: "1",
        destination: STRANGER,
        idempotencyKey: key(),
      });
      assert.equal(r.status, 403);
      codes.push(r.body.denial!.rule_code);
      assert.equal(r.body.denial!.next_step.action, "ask_guardian");
    }
    assert.deepEqual(codes, ["allowlist_miss", "allowlist_miss"]);
  });

  it("a daily-cap refusal carries the numbers and says to wait for the window", async () => {
    const { agent } = fixture({ hitlAboveUsdc: 100 });
    const ok = await call("/v1/agent/pay", agent.apiKey, {
      amountUsdc: "100",
      destination: PAYEE,
      idempotencyKey: key(),
    });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const r = await call("/v1/agent/pay", agent.apiKey, {
      amountUsdc: "60",
      destination: PAYEE,
      idempotencyKey: key(),
    });
    assert.equal(r.status, 403);
    assert.equal(r.body.denial?.rule_code, "daily_max");
    assert.equal(r.body.denial?.next_step.action, "wait_for_window");
    assert.deepEqual(
      {
        cap: r.body.denial?.numbers?.cap,
        used: r.body.denial?.numbers?.used,
        remaining: r.body.denial?.numbers?.remaining,
      },
      { cap: "150", used: "100", remaining: "50" },
    );
  });
});

describe("an agent cannot approve its own request", () => {
  it("the requesting agent's API key is refused with self_approval_forbidden", async () => {
    const { org, agent } = fixture();
    const parked = await park(agent.apiKey);
    const r = await call(`/v1/guardian/approvals/${parked.approvalId}/resolve`, agent.apiKey, {
      approve: true,
      resolvedBy: "me",
    });
    assert.equal(r.status, 403);
    assert.equal(r.body.error?.rule_code, "self_approval_forbidden");
    assert.equal(r.body.denial?.rule_code, "self_approval_forbidden");
    assert.equal(r.body.denial?.payment_state, "awaiting_approval");
    const still = store.getApproval(parked.approvalId!, org.id)!;
    assert.equal(still.status, "pending");
    assert.equal(still.requestedBy, `agent:${agent.agentId}`);
    assert.equal(store.listVotes(still.id).length, 0, "no vote recorded");
    assert.equal(store.getSettlement(parked.intentId!), undefined, "nothing sent");
    const refused = events(org.id, "approval.vote_refused");
    assert.equal(refused.at(-1)?.rule_code, "self_approval_forbidden");
  });

  it("a session key of the same agent is refused too", async () => {
    const { org, agent } = fixture();
    const minted = await call(
      `/v1/guardian/agents/${agent.agentId}/session-keys`,
      org.guardianKey,
      {
        scopes: ["read", "pay"],
      },
    );
    assert.equal(minted.status, 201, JSON.stringify(minted.body));
    const sessionToken = minted.body.sessionKey!.token;
    const parked = await park(sessionToken);
    const approval = store.getApproval(parked.approvalId!, org.id)!;
    assert.equal(approval.requestedBy, `session:${minted.body.sessionKey!.id}`);
    for (const credential of [sessionToken, agent.apiKey]) {
      const r = await call(`/v1/guardian/approvals/${parked.approvalId}/resolve`, credential, {
        approve: true,
      });
      assert.equal(r.status, 403);
      assert.equal(r.body.error?.rule_code, "self_approval_forbidden");
    }
    assert.equal(store.getApproval(parked.approvalId!, org.id)!.status, "pending");
  });

  it("another agent's key is refused with agent_cannot_approve", async () => {
    const { org, agent, peer } = fixture();
    const parked = await park(agent.apiKey);
    const r = await call(`/v1/guardian/approvals/${parked.approvalId}/resolve`, peer.apiKey, {
      approve: true,
    });
    assert.equal(r.status, 403);
    assert.equal(r.body.error?.rule_code, "agent_cannot_approve");
    assert.equal(store.getApproval(parked.approvalId!, org.id)!.status, "pending");
  });

  it("the engine refuses the requester even if a caller passes it through", async () => {
    const { org, agent } = fixture();
    const parked = await park(agent.apiKey);
    const out = await resolveApproval(
      org.id,
      parked.approvalId!,
      true,
      "spoofed guardian name",
      `agent:${agent.agentId}`,
    );
    assert.equal(out.kind, "refused");
    assert.equal(out.kind === "refused" && out.ruleCode, "self_approval_forbidden");
    assert.equal(store.listVotes(parked.approvalId!).length, 0);
    assert.equal(store.getApproval(parked.approvalId!, org.id)!.status, "pending");
  });

  it("a guardian can still approve it", async () => {
    const { org, agent } = fixture();
    const parked = await park(agent.apiKey);
    const r = await call(`/v1/guardian/approvals/${parked.approvalId}/resolve`, org.guardianKey, {
      approve: true,
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.approval?.status, "approved");
  });
});

describe("approvals expire after a fixed, configurable time", () => {
  it("the window is APPROVAL_TTL_MINUTES, with safe fallbacks", async () => {
    const { org, agent } = fixture();
    const parked = await park(agent.apiKey);
    const a = store.getApproval(parked.approvalId!, org.id)!;
    const ms = Date.parse(a.expiresAt) - Date.parse(a.createdAt);
    assert.ok(Math.abs(ms - 7 * 60_000) < 2_000, `expected ~7 min, got ${ms} ms`);

    const saved = process.env.APPROVAL_TTL_MINUTES;
    try {
      for (const bad of ["abc", "0", "-5", ""]) {
        process.env.APPROVAL_TTL_MINUTES = bad;
        assert.equal(approvalTtlMinutes(), 10, `fallback for ${JSON.stringify(bad)}`);
      }
      process.env.APPROVAL_TTL_MINUTES = "999999";
      assert.equal(approvalTtlMinutes(), 14 * 24 * 60, "clamped to 14 days");
    } finally {
      process.env.APPROVAL_TTL_MINUTES = saved;
    }
  });

  it("an expired approval ends as expired, not sent — never an automatic yes", async () => {
    const { org, agent, budget } = fixture();
    const balance = budgetBalance(org.id, budget.id);
    const idem = key();
    const parked = (
      await call("/v1/agent/pay", agent.apiKey, {
        amountUsdc: "60",
        destination: PAYEE,
        idempotencyKey: idem,
      })
    ).body;
    assert.ok(parked.approvalId);
    store.setApprovalExpiresAtForTests(
      parked.approvalId!,
      new Date(Date.now() - 1_000).toISOString(),
    );

    // The guardian tries to approve after the deadline: refused, nothing sent.
    const late = await call(
      `/v1/guardian/approvals/${parked.approvalId}/resolve`,
      org.guardianKey,
      {
        approve: true,
      },
    );
    assert.equal(late.status, 409);
    assert.equal(late.body.error?.code, "APPROVAL_TIMEOUT");
    assert.equal(late.body.denial?.payment_state, "expired_not_sent");
    assert.equal(late.body.denial?.rule_code, "approval_timeout");
    assert.equal(late.body.denial?.next_step.action, "repropose");

    const a = store.getApproval(parked.approvalId!, org.id)!;
    assert.equal(a.status, "expired");
    assert.equal(a.resolvedBy, "system:approval_expiry");
    assert.equal(store.getSettlement(parked.intentId!), undefined, "nothing broadcast");
    assert.equal(budgetBalance(org.id, budget.id), balance, "nothing held or charged");
    assert.equal(store.spentLast24h(agent.agentId), 0n);

    // A second approve, and further sweeps, still change nothing.
    sweepApprovalExpiry();
    const again = await call(
      `/v1/guardian/approvals/${parked.approvalId}/resolve`,
      org.guardianKey,
      {
        approve: true,
      },
    );
    assert.equal(again.status, 409);
    assert.equal(store.getApproval(parked.approvalId!, org.id)!.status, "expired");
    assert.equal(store.getSettlement(parked.intentId!), undefined);

    // The agent sees it as expired, and a retry under the same key replays
    // "expired, not sent" instead of parking or sending anything.
    const seen = await call(
      `/v1/agent/approvals/${parked.approvalId}`,
      agent.apiKey,
      undefined,
      "GET",
    );
    assert.equal(seen.body.approval?.status, "expired");
    const replay = await call("/v1/agent/pay", agent.apiKey, {
      amountUsdc: "60",
      destination: PAYEE,
      idempotencyKey: idem,
    });
    assert.equal(replay.status, 409);
    assert.equal(replay.body.replayed, true);
    assert.equal(replay.body.denial?.payment_state, "expired_not_sent");
    assert.equal(store.listApprovals(org.id).length, 1, "no second approval parked");
  });

  it("approval.resolved reports status expired with a named owner", async () => {
    const { org, agent } = fixture();
    const parked = await park(agent.apiKey);
    store.setApprovalExpiresAtForTests(
      parked.approvalId!,
      new Date(Date.now() - 1_000).toISOString(),
    );
    sweepApprovalExpiry();
    const resolved = events(org.id, "approval.resolved").filter(
      (e) => e.approvalId === parked.approvalId,
    );
    assert.equal(resolved.length, 1, "exactly one event");
    const e = resolved[0] as {
      status: string;
      resolvedBy: string;
      intentId: string;
      owner: { role: string; name: string };
      denial: Denial;
    };
    assert.equal(e.status, "expired");
    assert.equal(e.resolvedBy, "system:approval_expiry");
    assert.equal(e.intentId, parked.intentId);
    assert.equal(e.owner.role, "owner");
    assert.ok(e.owner.name.length > 0);
    assert.equal(e.denial.payment_state, "expired_not_sent");
  });

  it("an approval a guardian already claimed is never overwritten by the expiry sweep", async () => {
    const { org, agent } = fixture();
    const parked = await park(agent.apiKey);
    assert.ok(store.claimApproval(parked.approvalId!));
    store.setApprovalExpiresAtForTests(
      parked.approvalId!,
      new Date(Date.now() - 1_000).toISOString(),
    );
    assert.equal(
      store.expireApproval(parked.approvalId!, {
        resolvedAt: new Date().toISOString(),
        resolvedBy: "system:approval_expiry",
        result: {},
      }),
      false,
    );
    assert.equal(store.getApproval(parked.approvalId!, org.id)!.status, "resolving");
  });
});

describe("x402 session budgets", () => {
  async function mint(orgKey: string, agentId: string, budget?: string) {
    const r = await call(`/v1/guardian/agents/${agentId}/session-keys`, orgKey, {
      scopes: ["read", "pay"],
      ...(budget !== undefined && { x402BudgetUsdc: budget }),
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body.sessionKey!;
  }
  const payApi = (k: string, amountUsdc: string) =>
    call("/v1/agent/pay_api", k, { amountUsdc, destination: VENDOR, idempotencyKey: key() });

  it("a session key cannot spend past its x402 budget", async () => {
    const { org, agent } = fixture();
    const session = await mint(org.guardianKey, agent.agentId, "5");
    assert.equal(session.x402BudgetUsdc, "5");
    assert.equal((await payApi(session.token, "3")).status, 200);
    const over = await payApi(session.token, "3");
    assert.equal(over.status, 403);
    assert.equal(over.body.denial?.rule_code, "session_budget");
    assert.equal(over.body.denial?.next_step.action, "request_new_session");
    assert.deepEqual(
      {
        cap: over.body.denial?.numbers?.cap,
        used: over.body.denial?.numbers?.used,
        remaining: over.body.denial?.numbers?.remaining,
      },
      { cap: "5", used: "3", remaining: "2" },
    );
    assert.equal((await payApi(session.token, "2")).status, 200, "exactly the remainder fits");
    assert.equal((await payApi(session.token, "0.01")).status, 403);
    const listed = store.listSessionKeys(org.id, agent.agentId).find((s) => s.id === session.id);
    assert.equal(listed?.x402SpentUsdc, "5");
    // The agent's own key and a budget-less session are not bound by it.
    assert.equal((await payApi(agent.apiKey, "3")).status, 200);
    const open = await mint(org.guardianKey, agent.agentId);
    assert.equal(open.x402BudgetUsdc, undefined);
    assert.equal((await payApi(open.token, "3")).status, 200);
  });

  it("two concurrent payments cannot both spend the same session headroom", async () => {
    const { org, agent } = fixture();
    const session = await mint(org.guardianKey, agent.agentId, "5");
    const results = await Promise.all([payApi(session.token, "3"), payApi(session.token, "3")]);
    const statuses = results.map((r) => r.status).sort();
    assert.deepEqual(statuses, [200, 403]);
    const refused = results.find((r) => r.status === 403)!;
    assert.equal(refused.body.denial?.rule_code, "session_budget");
    assert.equal(store.sessionX402SpentMicro(session.id), 3_000_000n);
  });
});

describe("session budget reservation is atomic", () => {
  it("a second reservation on the same headroom is refused before anything is sent", () => {
    const { org, agent } = fixture();
    const session = store.createSessionKey({
      orgId: org.id,
      agentId: agent.agentId,
      scopes: ["read", "pay"],
      x402BudgetMicro: 5_000_000n,
    });
    const reserve = (intentId: string) =>
      store.reserveSpendCaps({
        orgId: org.id,
        agentId: agent.agentId,
        intentId,
        destination: VENDOR,
        amountMicro: 3_000_000n,
        tool: "pay_api",
        session: { id: session.id, budgetMicro: 5_000_000n },
      });
    assert.deepEqual(reserve(id("int")), { ok: true });
    const second = reserve(id("int"));
    assert.equal(second.ok, false);
    assert.equal(!second.ok && second.rule, "session_budget");
    assert.equal(store.sessionX402SpentMicro(session.id), 3_000_000n, "in-flight spend counts");
  });
});

describe("fail closed", () => {
  it("a policy that cannot be read is a refusal with a rule code, and nothing moves", async () => {
    const { org, agent, budget } = fixture();
    const balance = budgetBalance(org.id, budget.id);
    const idem = key();
    const original = store.getPolicyTemplate;
    store.getPolicyTemplate = () => {
      throw new Error("policy row unreadable");
    };
    let r: Awaited<ReturnType<typeof call>>;
    try {
      r = await call("/v1/agent/pay", agent.apiKey, {
        amountUsdc: "10",
        destination: PAYEE,
        idempotencyKey: idem,
      });
    } finally {
      store.getPolicyTemplate = original;
    }
    assert.equal(r.status, 503);
    assert.equal(r.body.outcome, "deny");
    assert.equal(r.body.error?.code, "POLICY_UNAVAILABLE");
    assert.equal(r.body.denial?.rule_code, "policy_unavailable");
    assert.equal(r.body.denial?.payment_state, "not_sent");
    assert.equal(r.body.denial?.next_step.action, "retry_later");
    assert.equal(store.getSettlement(r.body.intentId!), undefined);
    assert.equal(budgetBalance(org.id, budget.id), balance);
    // The key was freed: the same request goes through once the policy reads.
    const retry = await call("/v1/agent/pay", agent.apiKey, {
      amountUsdc: "10",
      destination: PAYEE,
      idempotencyKey: idem,
    });
    assert.equal(retry.status, 200, JSON.stringify(retry.body));
  });

  it("an unreadable session budget counts as zero, not unlimited", async () => {
    const { org, agent } = fixture();
    const session = store.createSessionKey({
      orgId: org.id,
      agentId: agent.agentId,
      scopes: ["read", "pay"],
      x402BudgetMicro: 5_000_000n,
    });
    store.setSessionBudgetRawForTests(session.id, "not-a-number");
    const r = await call("/v1/agent/pay_api", session.token!, {
      amountUsdc: "1",
      destination: VENDOR,
      idempotencyKey: key(),
    });
    assert.equal(r.status, 403);
    assert.equal(r.body.denial?.rule_code, "session_budget");
  });
});

describe("inflows never grow limits", () => {
  it("money arriving in the budget or from another agent leaves caps and spend unchanged", async () => {
    const { org, agent, peer, budget } = fixture({ hitlAboveUsdc: 100 });
    const policyBefore = JSON.stringify(store.getPolicyTemplate(org.id), (_k, v) =>
      typeof v === "bigint" ? v.toString() : v,
    );
    assert.equal(
      (
        await call("/v1/agent/pay", agent.apiKey, {
          amountUsdc: "100",
          destination: PAYEE,
          idempotencyKey: key(),
        })
      ).status,
      200,
    );
    const rulesBefore = rulesFor(agent.agentId, org.id, PAYEE);
    assert.equal(rulesBefore.spentLast24hMicro, 100_000_000n);

    // Inflow 1: a large top-up of the agent's budget.
    store.applyEntries(org.id, [
      {
        id: id("j"),
        orgId: org.id,
        memo: "inflow",
        createdAt: new Date().toISOString(),
        lines: [
          { accountId: `org:${org.id}:available`, deltaMicro: -400_000_000n },
          { accountId: `dept:${budget.id}:available`, deltaMicro: 400_000_000n },
        ],
      },
    ]);
    // Inflow 2: another agent pays this one through an escrow that is released.
    const lock = await call("/v1/agent/escrow/lock", peer.apiKey, {
      amountUsdc: "30",
      payeeAgentId: agent.agentId,
      idempotencyKey: key(),
    });
    assert.equal(lock.status, 200, JSON.stringify(lock.body));
    const escrowId = (lock.body as { escrowId?: string }).escrowId!;
    const release = await call(`/v1/guardian/escrows/${escrowId}/resolve`, org.guardianKey, {
      action: "release",
    });
    assert.equal(release.status, 200, JSON.stringify(release.body));

    const rulesAfter = rulesFor(agent.agentId, org.id, PAYEE);
    assert.equal(rulesAfter.dailyMaxMicro, rulesBefore.dailyMaxMicro);
    assert.equal(rulesAfter.perTxMaxMicro, rulesBefore.perTxMaxMicro);
    assert.equal(rulesAfter.monthlyMaxMicro, rulesBefore.monthlyMaxMicro);
    assert.equal(rulesAfter.spentLast24hMicro, 100_000_000n, "inflows never reduce spend");
    assert.equal(rulesAfter.spentLast30dMicro, rulesBefore.spentLast30dMicro);
    assert.equal(
      JSON.stringify(store.getPolicyTemplate(org.id), (_k, v) =>
        typeof v === "bigint" ? v.toString() : v,
      ),
      policyBefore,
      "policy untouched",
    );

    // Headroom is still exactly what it was: $50 of the $150 daily cap.
    const over = await call("/v1/agent/pay", agent.apiKey, {
      amountUsdc: "60",
      destination: PAYEE,
      idempotencyKey: key(),
    });
    assert.equal(over.status, 403);
    assert.equal(over.body.denial?.rule_code, "daily_max");
    assert.equal(over.body.denial?.numbers?.remaining, "50");
  });
});
