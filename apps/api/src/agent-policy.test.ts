/**
 * Per-agent policy, end to end through the store and engine.
 *
 * The policy package proves the merge is correct in isolation; this proves the
 * plumbing actually reaches a payment — that an override is persisted, resolved
 * by `rulesFor`, and enforced by `executeIntent`. Without that, the merge would
 * be correct and unused, which is the state the audit found.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "pv-agentpolicy-"));
process.env.POLICYVAULT_DB = join(dir, "ap.db");
process.env.ABI_KEY_PEPPER = "test-pepper";
process.env.ABI_KEK = "test-kek";
process.env.ABI_NO_LISTEN = "1";
process.env.POLICYVAULT_MOCK_TRANSFER = "1";
process.env.ABI_CHAT_LLM = "0";

const { store } = await import("./store.js");
const { rulesFor, resolvedPolicyFor, executeIntent, id } = await import("./engine.js");
const { evaluatePolicy } = await import("@policyvault/policy");

after(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

const VENDOR = "api.openai.com";

function orgWithTwoAgents() {
  const org = store.createOrg("Layered Co", 1_000_000_000n);
  const tight = store.createAgent(org.id, "Tight");
  const loose = store.createAgent(org.id, "Loose");
  const t = store.getPolicyTemplate(org.id);
  store.setPolicyTemplate(org.id, {
    ...t,
    vendorAllowlist: [VENDOR],
    perTxMaxMicro: 25_000_000n,
    dailyMaxMicro: 100_000_000n,
    hitlAboveMicro: 20_000_000n,
    newCounterpartyCooldownHours: 0,
  });
  store.addKnownCounterparty(org.id, VENDOR);
  for (const a of [tight, loose]) {
    store.applyEntries(org.id, [
      {
        id: id("j"),
        orgId: org.id,
        memo: "seed",
        createdAt: new Date().toISOString(),
        lines: [
          { accountId: `org:${org.id}:available`, deltaMicro: -100_000_000n },
          { accountId: `agent:${a.agentId}:available`, deltaMicro: 100_000_000n },
        ],
      },
    ]);
  }
  return { org, tight, loose };
}

const intentFor = (agentId: string, orgId: string, amountMicro: bigint) => ({
  agentId,
  orgId,
  tool: "pay_api" as const,
  amountMicro,
  destination: VENDOR,
  idempotencyKey: "k",
});

describe("agent policy overrides", () => {
  it("leaves an agent on the org default until one is set", () => {
    const { org, tight } = orgWithTwoAgents();
    assert.equal(store.getAgentPolicyOverrideAnyOrg(tight.agentId), null);
    const { provenance } = resolvedPolicyFor(tight.agentId, org.id);
    assert.equal(provenance.perTxMaxMicro, "org");
  });

  it("persists an override and reports its provenance", () => {
    const { org, tight } = orgWithTwoAgents();
    store.setAgentPolicyOverride(org.id, tight.agentId, { perTxMaxMicro: 2_000_000n }, "alice");

    const { effective, provenance } = resolvedPolicyFor(tight.agentId, org.id);
    assert.equal(effective.perTxMaxMicro, 2_000_000n);
    assert.equal(provenance.perTxMaxMicro, "agent");
    assert.equal(provenance.dailyMaxMicro, "org", "unset fields still inherit");
  });

  it("survives a round trip through JSON, bigints intact", () => {
    const { org, tight } = orgWithTwoAgents();
    store.setAgentPolicyOverride(org.id, tight.agentId, {
      perTxMaxMicro: 12_345_678n,
      vendorAllowlist: ["only-this.example"],
    });
    const back = store.getAgentPolicyOverrideAnyOrg(tight.agentId)!;
    assert.equal(back.perTxMaxMicro, 12_345_678n, "bigint must not become a string");
    assert.deepEqual(back.vendorAllowlist, ["only-this.example"]);
  });

  it("constrains one agent without touching its sibling", () => {
    // The headline capability: two agents in one org, different limits.
    const { org, tight, loose } = orgWithTwoAgents();
    store.setAgentPolicyOverride(org.id, tight.agentId, { perTxMaxMicro: 2_000_000n });

    const amount = 5_000_000n; // $5 — under the org's $25, over Tight's $2
    assert.equal(
      evaluatePolicy(
        intentFor(tight.agentId, org.id, amount),
        rulesFor(tight.agentId, org.id, VENDOR),
      ).outcome,
      "deny",
    );
    assert.equal(
      evaluatePolicy(
        intentFor(loose.agentId, org.id, amount),
        rulesFor(loose.agentId, org.id, VENDOR),
      ).outcome,
      "allow",
    );
  });

  it("restores the org default when the override is cleared", () => {
    const { org, tight } = orgWithTwoAgents();
    store.setAgentPolicyOverride(org.id, tight.agentId, { perTxMaxMicro: 2_000_000n });
    assert.equal(store.clearAgentPolicyOverride(tight.agentId), true);

    const { effective, provenance } = resolvedPolicyFor(tight.agentId, org.id);
    assert.equal(effective.perTxMaxMicro, 25_000_000n);
    assert.equal(provenance.perTxMaxMicro, "org");
  });

  it("ignores a corrupted override rather than blocking the agent", () => {
    // A bad row must degrade to the org default, not fail every payment.
    const { org, tight } = orgWithTwoAgents();
    store.setAgentPolicyOverride(org.id, tight.agentId, { perTxMaxMicro: 2_000_000n });
    store.setAgentPolicyRawForTests(tight.agentId, "{not json");

    assert.equal(store.getAgentPolicyOverrideAnyOrg(tight.agentId), null);
    assert.equal(resolvedPolicyFor(tight.agentId, org.id).effective.perTxMaxMicro, 25_000_000n);
  });

  it("lists which agents deviate from the default", () => {
    const { org, tight } = orgWithTwoAgents();
    store.setAgentPolicyOverride(org.id, tight.agentId, { perTxMaxMicro: 2_000_000n });
    const overrides = store.listAgentPolicyOverrides(org.id);
    assert.equal(overrides.length, 1);
    assert.equal(overrides[0]!.agentId, tight.agentId);
  });
});

describe("organization-wide spend", () => {
  it("aggregates across every agent", async () => {
    const { org, tight, loose } = orgWithTwoAgents();
    for (const a of [tight, loose]) {
      await executeIntent({
        orgId: org.id,
        agentId: a.agentId,
        tool: "pay_api",
        amountMicro: 3_000_000n,
        amountUsdc: "3",
        destination: VENDOR,
        intentId: id("int"),
      });
    }
    assert.equal(store.orgSpentLast24h(org.id), 6_000_000n, "both agents must count");
    assert.equal(store.spentLast24h(tight.agentId), 3_000_000n, "per-agent stays per-agent");
  });

  it("enforces the org ceiling against a fleet", async () => {
    const { org, tight, loose } = orgWithTwoAgents();
    const t = store.getPolicyTemplate(org.id);
    store.setPolicyTemplate(org.id, { ...t, orgDailyMaxMicro: 10_000_000n });

    // Tight spends $8 — fine on its own, and well under its own daily cap.
    await executeIntent({
      orgId: org.id,
      agentId: tight.agentId,
      tool: "pay_api",
      amountMicro: 8_000_000n,
      amountUsdc: "8",
      destination: VENDOR,
      intentId: id("int"),
    });

    // Loose now tries $5. Its own limits allow it; the org's do not.
    const decision = evaluatePolicy(
      intentFor(loose.agentId, org.id, 5_000_000n),
      rulesFor(loose.agentId, org.id, VENDOR),
    );
    assert.equal(decision.outcome, "deny");
    assert.deepEqual(decision.ruleIds, ["org_daily_max"]);
  });
});

describe("counterparty first-seen", () => {
  it("is recorded the first time and not overwritten afterwards", () => {
    const org = store.createOrg("Cooldown Co", 0n);
    store.addKnownCounterparty(org.id, "vendor.example");
    const first = store.counterpartyFirstSeenMs(org.id, "vendor.example");
    assert.ok(first, "first sighting must be timestamped");

    store.addKnownCounterparty(org.id, "VENDOR.example");
    assert.equal(
      store.counterpartyFirstSeenMs(org.id, "vendor.example"),
      first,
      "re-adding must not restart the cooldown",
    );
  });

  it("is undefined for a destination never seen", () => {
    const org = store.createOrg("Fresh Co", 0n);
    assert.equal(store.counterpartyFirstSeenMs(org.id, "never.example"), undefined);
  });
});
