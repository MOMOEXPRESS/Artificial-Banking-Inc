/**
 * Idempotency and replay semantics, exercised over real HTTP.
 *
 * This logic lives in `handleIntent`, which is HTTP-coupled and therefore not
 * reachable from the engine tests. The guarantee it provides is the one the
 * README leads with: the key is *reserved* before the rail runs, so two
 * concurrent retries of the same payment settle exactly once — a check-then-
 * write would leave the whole network round trip open to a double-spend.
 */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "pv-idem-"));
process.env.POLICYVAULT_DB = join(dir, "idem.db");
process.env.ABI_KEY_PEPPER = "test-pepper";
process.env.ABI_NO_LISTEN = "1";
process.env.POLICYVAULT_MOCK_TRANSFER = "1";
process.env.ABI_CHAT_LLM = "0";
process.env.ABI_CHAT_AGENT = "0";
process.env.POLICYVAULT_ALLOW_BOOTSTRAP = "0";

const { store } = await import("./store.js");
const { app } = await import("./index.js");

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
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

/** Org + funded agent with an allowlisted payee and a $50 approval threshold. */
function fixture() {
  const org = store.createOrg("Idem Co", 1_000_000_000n);
  const agent = store.createAgent(org.id, "Spender");
  const t = store.getPolicyTemplate(org.id);
  store.setPolicyTemplate(org.id, {
    ...t,
    addressAllowlist: [PAYEE],
    perTxMaxMicro: 100_000_000n,
    dailyMaxMicro: 500_000_000n,
    hitlAboveMicro: 50_000_000n,
    newCounterpartyCooldownHours: 0,
  });
  store.addKnownCounterparty(org.id, PAYEE);
  store.applyEntries(org.id, [
    {
      id: `j_${Math.abs(Date.now() % 1e9)}_${org.id.slice(-6)}`,
      orgId: org.id,
      memo: "seed",
      createdAt: new Date().toISOString(),
      lines: [
        { accountId: `org:${org.id}:available`, deltaMicro: -300_000_000n },
        { accountId: `agent:${agent.agentId}:available`, deltaMicro: 300_000_000n },
      ],
    },
  ]);
  return { org, agent };
}

const balanceOf = (orgId: string, agentId: string) =>
  store.getAccountMap(orgId).get(`agent:${agentId}:available`)?.balanceMicro ?? 0n;

type PayBody = {
  replayed?: boolean;
  approvalId?: string;
  error?: { code?: string };
};

/** `Response.json()` is `unknown`; every read here is a known API envelope. */
const asBody = (r: Response) => r.json() as Promise<PayBody>;

function pay(apiKey: string, body: Record<string, unknown>) {
  return fetch(`${base}/v1/agent/pay`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
}

describe("POST /v1/agent/pay — idempotency", () => {
  it("settles exactly once when the same key is retried", async () => {
    const { org, agent } = fixture();
    const body = {
      amountUsdc: "10",
      destination: PAYEE,
      idempotencyKey: "retry-me-please",
    };

    const first = await pay(agent.apiKey, body);
    assert.equal(first.status, 200);

    const second = await pay(agent.apiKey, body);
    assert.equal(second.status, 200);
    assert.equal((await asBody(second)).replayed, true, "second call must replay, not execute");

    assert.equal(
      balanceOf(org.id, agent.agentId),
      290_000_000n,
      "exactly one $10 payment may have left",
    );
  });

  it("settles exactly once under concurrent retries", async () => {
    // The reason the key is reserved before the rail runs rather than after.
    const { org, agent } = fixture();
    const body = {
      amountUsdc: "10",
      destination: PAYEE,
      idempotencyKey: "concurrent-key",
    };

    const results = await Promise.all([
      pay(agent.apiKey, body),
      pay(agent.apiKey, body),
      pay(agent.apiKey, body),
      pay(agent.apiKey, body),
    ]);

    const settled = results.filter((r) => r.status === 200);
    const inFlight = results.filter((r) => r.status === 409);
    assert.equal(settled.length + inFlight.length, results.length, "no unexpected statuses");
    assert.ok(settled.length >= 1, "at least one must settle");

    assert.equal(
      balanceOf(org.id, agent.agentId),
      290_000_000n,
      "concurrent retries must not double-spend",
    );
  });

  it("replays a denial as a denial, not as HTTP 200", async () => {
    // A cached deny returned as a success would tell the agent its payment
    // went through when nothing moved.
    const { org, agent } = fixture();
    const body = {
      amountUsdc: "500", // above per-tx max
      destination: PAYEE,
      idempotencyKey: "denied-key",
    };

    const first = await pay(agent.apiKey, body);
    assert.equal(first.status, 403);
    assert.equal((await asBody(first)).error?.code, "POLICY_DENIED");

    const replay = await pay(agent.apiKey, body);
    assert.equal(replay.status, 403, "replayed denial must keep its status");
    const replayBody = await asBody(replay);
    assert.equal(replayBody.replayed, true);
    assert.equal(replayBody.error?.code, "POLICY_DENIED");

    assert.equal(balanceOf(org.id, agent.agentId), 300_000_000n, "nothing moved");
  });

  it("replays a parked approval instead of parking a second one", async () => {
    // Two live approvals for one intent could each be approved, paying twice.
    const { org, agent } = fixture();
    const body = {
      amountUsdc: "60", // above the $50 HITL threshold
      destination: PAYEE,
      idempotencyKey: "parked-key",
    };

    const first = await pay(agent.apiKey, body);
    assert.equal(first.status, 202);
    const firstId = (await asBody(first)).approvalId;

    const second = await pay(agent.apiKey, body);
    assert.equal(second.status, 202);
    const secondBody = await asBody(second);
    assert.equal(secondBody.approvalId, firstId, "must reference the same approval");
    assert.equal(secondBody.replayed, true);

    const pending = store.listApprovals(org.id, "pending");
    assert.equal(pending.length, 1, "exactly one approval may exist for this intent");
  });

  it("scopes the key per agent, so two agents may reuse the same string", async () => {
    const { org, agent } = fixture();
    const other = store.createAgent(org.id, "Second");
    store.applyEntries(org.id, [
      {
        id: `j_other_${org.id.slice(-6)}`,
        orgId: org.id,
        memo: "seed2",
        createdAt: new Date().toISOString(),
        lines: [
          { accountId: `org:${org.id}:available`, deltaMicro: -50_000_000n },
          { accountId: `agent:${other.agentId}:available`, deltaMicro: 50_000_000n },
        ],
      },
    ]);

    const body = { amountUsdc: "10", destination: PAYEE, idempotencyKey: "shared-string" };
    assert.equal((await pay(agent.apiKey, body)).status, 200);
    const second = await pay(other.apiKey, body);
    assert.equal(second.status, 200);
    assert.notEqual((await asBody(second)).replayed, true, "different agent must not replay");

    assert.equal(balanceOf(org.id, agent.agentId), 290_000_000n);
    assert.equal(balanceOf(org.id, other.agentId), 40_000_000n);
  });

  it("rejects an unauthenticated payment", async () => {
    const res = await fetch(`${base}/v1/agent/pay`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amountUsdc: "1", destination: PAYEE, idempotencyKey: "no-auth-key" }),
    });
    assert.equal(res.status, 401);
  });
});

describe("guardian route authorization", () => {
  it("refuses a viewer guardian's attempt to move money", async () => {
    const { org, agent } = fixture();
    const viewer = store.createGuardian(org.id, "Read Only", "viewer");

    const res = await fetch(`${base}/v1/guardian/allocate`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${viewer.guardianKey}` },
      body: JSON.stringify({ agentId: agent.agentId, amountUsdc: "10" }),
    });

    assert.equal(res.status, 403);
    assert.equal(balanceOf(org.id, agent.agentId), 300_000_000n);
  });

  it("derives the org from the key, never from the request", async () => {
    const a = fixture();
    const b = fixture();

    // Org A's key must not be able to fund org B's agent.
    const res = await fetch(`${base}/v1/guardian/allocate`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${a.org.guardianKey}` },
      body: JSON.stringify({ agentId: b.agent.agentId, amountUsdc: "10" }),
    });

    assert.equal(res.status, 404, "cross-tenant target must not resolve");
    assert.equal(balanceOf(b.org.id, b.agent.agentId), 300_000_000n);
  });
});
