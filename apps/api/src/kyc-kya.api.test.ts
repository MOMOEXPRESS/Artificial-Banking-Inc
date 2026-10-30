/**
 * In-house KYC / KYA: grandfathering, starter caps, verification lifting them,
 * embargo restriction, agent attestation, suspension and declared scope.
 * Mock rail only — no chain, no spend.
 */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "pv-kyc-"));
process.env.POLICYVAULT_DB = join(dir, "kyc.db");
process.env.ABI_KEY_PEPPER = "test-pepper";
process.env.ABI_NO_LISTEN = "1";
process.env.POLICYVAULT_MOCK_TRANSFER = "1";
process.env.ABI_CHAT_LLM = "0";
process.env.ABI_CHAT_AGENT = "0";
process.env.POLICYVAULT_ALLOW_BOOTSTRAP = "0";
process.env.ABI_COMPLIANCE_ENFORCE = "1";

const { store } = await import("./store.js");
const { app } = await import("./index.js");
const { id } = await import("./engine.js");
const kyc = await import("./kyc-kya.js");

const PAYEE = "0x5555555555555555555555555555555555555555";
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

type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
async function call(path: string, key: string, body?: unknown, method = "POST") {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: (await res.json()) as J };
}

let n = 0;
function fixture() {
  const org = store.createOrg(`KYC Co ${++n}`, 1_000_000_000n);
  const agent = store.createAgent(org.id, "Spender");
  const budget = store.createDepartment(org.id, "Budget");
  assert.equal(store.assignAgentBudget(org.id, agent.agentId, budget.id), "ok");
  const t = store.getPolicyTemplate(org.id);
  store.setPolicyTemplate(org.id, {
    ...t,
    addressAllowlist: [PAYEE],
    perTxMaxMicro: 400_000_000n,
    dailyMaxMicro: 900_000_000n,
    hitlAboveMicro: 800_000_000n,
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
        { accountId: `org:${org.id}:available`, deltaMicro: -900_000_000n },
        { accountId: `dept:${budget.id}:available`, deltaMicro: 900_000_000n },
      ],
    },
  ]);
  return { org, agent };
}

const pay = (agentKey: string, amountUsdc: string, destination = PAYEE) =>
  call("/v1/agent/pay", agentKey, {
    amountUsdc,
    destination,
    idempotencyKey: `kyc-${++n}-${Date.now()}`,
  });

const goodKyc = {
  entityType: "individual",
  legalName: "Ada Lovelace",
  country: "fr",
  ageAttested: true,
  sanctionsAttested: true,
  pepDeclared: false,
  intendedUse: "Agents buy research APIs",
  expectedMonthlyVolume: "under_1k",
  termsAccepted: true,
};
const attest = {
  purpose: "Buys market data",
  operator: "Ada Lovelace",
  model: "claude",
  provider: "anthropic",
  allowedCategories: [],
  allowedCounterparties: [],
  attest: true,
};

describe("KYC / KYA pure rules", () => {
  it("restricts embargoed countries and a refused sanctions attestation", () => {
    const base = {
      ...goodKyc,
      entityType: "individual" as const,
      expectedMonthlyVolume: "under_1k" as const,
    };
    assert.equal(
      kyc.evaluateKyc({ ...base, country: "KP" }, { ownerEmailVerified: true }).status,
      "restricted",
    );
    assert.equal(
      kyc.evaluateKyc({ ...base, sanctionsAttested: false }, { ownerEmailVerified: true }).status,
      "restricted",
    );
    assert.equal(kyc.evaluateKyc(base, { ownerEmailVerified: false }).status, "pending");
    const v = kyc.evaluateKyc(base, { ownerEmailVerified: true });
    assert.equal(v.status, "verified");
    assert.equal(v.riskTier, "low");
    assert.equal(
      kyc.evaluateKyc({ ...base, pepDeclared: true }, { ownerEmailVerified: true }).riskTier,
      "high",
    );
    assert.equal(
      kyc.evaluateKyc(
        { ...base, entityType: "business", businessName: "X" },
        { ownerEmailVerified: true },
      ).riskTier,
      "medium",
    );
  });

  it("flags anomalies without blocking", () => {
    const flags = kyc.anomalyFlags({
      decisions24h: 8,
      denials24h: 6,
      outOfScope24h: 1,
      pays1h: 12,
      pays7d: 14,
      newCounterparties24h: 6,
    });
    assert.deepEqual(flags.map((f) => f.code).sort(), [
      "new_counterparties",
      "out_of_scope_attempts",
      "refusal_spike",
      "velocity_spike",
    ]);
    assert.deepEqual(
      kyc.anomalyFlags({
        decisions24h: 3,
        denials24h: 1,
        outOfScope24h: 0,
        pays1h: 1,
        pays7d: 50,
        newCounterparties24h: 0,
      }),
      [],
    );
  });

  it("fingerprints are stable and never the key", () => {
    const f = kyc.keyFingerprint("hash:abc");
    assert.match(f, /^[0-9a-f]{4}(:[0-9a-f]{4}){3}$/);
    assert.equal(f, kyc.keyFingerprint("hash:abc"));
  });

  it("matches declared counterparties by host and subdomain", () => {
    assert.equal(kyc.counterpartyAllowed("https://api.example.com/x", ["example.com"]), true);
    assert.equal(kyc.counterpartyAllowed("https://evil.com/example.com", ["example.com"]), false);
    assert.equal(kyc.counterpartyAllowed(PAYEE.toUpperCase(), [PAYEE]), true);
  });
});

describe("KYC / KYA spend gate (API)", () => {
  it("a new org gets starter caps until KYC + KYA; verification lifts them", async () => {
    const { org, agent } = fixture();
    let r = await pay(agent.apiKey, "30");
    assert.equal(r.status, 403);
    assert.equal(r.body.denial.rule_code, "kyc_tier_per_tx");
    assert.equal(r.body.denial.next_step.action, "lower_amount");
    assert.equal(r.body.denial.numbers.cap, "25");
    r = await pay(agent.apiKey, "20");
    assert.equal(r.status, 200, JSON.stringify(r.body));

    const status = await call("/v1/guardian/compliance/kyc", org.guardianKey, undefined, "GET");
    assert.equal(status.body.status, "unverified");
    assert.equal(status.body.orgLimits.state, "capped");
    assert.equal(status.body.grandfathered, false);

    const sub = await call("/v1/guardian/compliance/kyc", org.guardianKey, goodKyc, "PUT");
    assert.equal(sub.status, 200, JSON.stringify(sub.body));
    // Guardian-key org without a user: no verified owner email → pending.
    assert.equal(sub.body.status, "pending");
    r = await pay(agent.apiKey, "30");
    assert.equal(r.body.denial?.rule_code, "kyc_tier_per_tx");

    // Simulate a verified owner by flipping the stored status (owner email path is covered by effectiveKyc).
    const rec = store.getOrgKyc(org.id)!;
    store.upsertOrgKyc({ ...rec, status: "verified" });
    r = await pay(agent.apiKey, "30");
    // KYC verified, agent still unattested → still capped.
    assert.equal(r.body.denial?.rule_code, "kyc_tier_per_tx");

    const a = await call(
      `/v1/guardian/compliance/agents/${agent.agentId}`,
      org.guardianKey,
      attest,
      "PUT",
    );
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.equal(a.body.agent.status, "attested");
    assert.equal(a.body.agent.spending.state, "policy");
    r = await pay(agent.apiKey, "30");
    assert.equal(r.status, 200, JSON.stringify(r.body));
  });

  it("grandfathered orgs keep their limits; restriction still applies", async () => {
    const { org, agent } = fixture();
    store.__setComplianceGrandfatheredForTests(org.id);
    assert.equal(store.isComplianceGrandfathered(org.id), true);
    let r = await pay(agent.apiKey, "300");
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const sub = await call(
      "/v1/guardian/compliance/kyc",
      org.guardianKey,
      { ...goodKyc, country: "IR" },
      "PUT",
    );
    assert.equal(sub.body.status, "restricted");
    r = await pay(agent.apiKey, "1");
    assert.equal(r.status, 403);
    assert.equal(r.body.denial.rule_code, "kyc_restricted");
  });

  it("suspension blocks and reinstatement restores; declared scope is enforced", async () => {
    const { org, agent } = fixture();
    store.__setComplianceGrandfatheredForTests(org.id);
    let s = await call(`/v1/guardian/compliance/agents/${agent.agentId}/suspend`, org.guardianKey, {
      reason: "odd behaviour",
    });
    assert.equal(s.status, 200);
    let r = await pay(agent.apiKey, "1");
    assert.equal(r.body.denial?.rule_code, "kya_suspended");
    s = await call(
      `/v1/guardian/compliance/agents/${agent.agentId}/reinstate`,
      org.guardianKey,
      {},
    );
    assert.equal(s.status, 200);
    r = await pay(agent.apiKey, "1");
    assert.equal(r.status, 200, JSON.stringify(r.body));

    const scoped = await call(
      `/v1/guardian/compliance/agents/${agent.agentId}`,
      org.guardianKey,
      { ...attest, allowedCounterparties: ["0x6666666666666666666666666666666666666666"] },
      "PUT",
    );
    assert.equal(scoped.status, 200);
    r = await pay(agent.apiKey, "1");
    assert.equal(r.body.denial?.rule_code, "kya_out_of_scope");
    const list = await call("/v1/guardian/compliance/agents", org.guardianKey, undefined, "GET");
    const row = list.body.agents.find((x: J) => x.agentId === agent.agentId);
    assert.equal(row.status, "attested");
    assert.ok(row.keyFingerprint);
    assert.ok(!JSON.stringify(list.body).includes(agent.apiKey));
  });

  it("KYC and KYA are org-isolated and owner-only", async () => {
    const a = fixture();
    const b = fixture();
    const cross = await call(
      `/v1/guardian/compliance/agents/${a.agent.agentId}`,
      b.org.guardianKey,
      attest,
      "PUT",
    );
    assert.equal(cross.status, 404);
    const bad = await call(
      "/v1/guardian/compliance/kyc",
      a.org.guardianKey,
      { ...goodKyc, termsAccepted: false },
      "PUT",
    );
    assert.equal(bad.status, 400);
  });
});
