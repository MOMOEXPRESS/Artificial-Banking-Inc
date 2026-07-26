/**
 * Subscription spend accumulation.
 *
 * Found by a Phase 2 smoke test, not by review: `recordSubscriptionRun` did its
 * arithmetic in SQL against a bound JS number, which SQLite binds as REAL. The
 * first successful charge wrote "2000000.0" into a column every reader parses
 * with BigInt(), so `GET /v1/guardian/subscriptions` returned HTTP 500 from
 * then on — permanently, for that org.
 *
 * It stayed invisible because the sweep that charges subscriptions never ran in
 * production. Fixing the sweep is what exposed it.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "pv-subs-"));
process.env.POLICYVAULT_DB = join(dir, "subs.db");
process.env.ABI_KEY_PEPPER = "test-pepper";
process.env.ABI_NO_LISTEN = "1";

const { store } = await import("./store.js");

after(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

function subscribe(amountMicro: bigint) {
  const demo = store.seedDemoOrg();
  const sub = {
    id: `sub_${Math.random().toString(16).slice(2, 14)}`,
    orgId: demo.orgId,
    agentId: demo.researcherAgentId,
    vendor: "api.openai.com",
    amountMicro,
    intervalHours: 24,
    status: "active" as const,
    createdAt: new Date().toISOString(),
    nextRunAt: new Date().toISOString(),
    runs: 0,
    spentMicro: 0n,
  };
  store.createSubscription(sub);
  return { orgId: demo.orgId, sub };
}

describe("recordSubscriptionRun", () => {
  it("accumulates spend as an exact integer and stays listable", () => {
    const { orgId, sub } = subscribe(2_000_000n);

    store.recordSubscriptionRun({
      subId: sub.id,
      chargedMicro: 2_000_000n,
      nextRunAt: new Date(Date.now() + 864e5).toISOString(),
    });

    // The regression: this threw `Cannot convert 2000000.0 to a BigInt`.
    const listed = store.listSubscriptions(orgId);
    assert.equal(listed.length, 1);
    assert.equal(listed[0]!.spentMicro, 2_000_000n);
    assert.equal(listed[0]!.runs, 1);
  });

  it("accumulates across several charges without drift", () => {
    const { orgId, sub } = subscribe(1_500_000n);
    for (let i = 0; i < 4; i++) {
      store.recordSubscriptionRun({
        subId: sub.id,
        chargedMicro: 1_500_000n,
        nextRunAt: new Date(Date.now() + 864e5).toISOString(),
      });
    }
    const listed = store.listSubscriptions(orgId)[0]!;
    assert.equal(listed.spentMicro, 6_000_000n);
    assert.equal(listed.runs, 4);
  });

  it("counts a failed run without adding to spend", () => {
    const { orgId, sub } = subscribe(1_000_000n);
    store.recordSubscriptionRun({
      subId: sub.id,
      chargedMicro: 0n,
      nextRunAt: new Date(Date.now() + 864e5).toISOString(),
      error: "deny: per_tx_max",
    });
    const listed = store.listSubscriptions(orgId)[0]!;
    assert.equal(listed.spentMicro, 0n);
    assert.equal(listed.runs, 1);
    assert.match(String(listed.lastError), /per_tx_max/);
  });

  it("still reads a row corrupted by the old REAL-valued write", () => {
    // Databases written by an earlier build carry "2000000.0". One such row
    // must not take down the whole list endpoint.
    const { orgId, sub } = subscribe(2_000_000n);
    store.setSubscriptionSpentForTests(sub.id, "2000000.0");

    const listed = store.listSubscriptions(orgId)[0]!;
    assert.equal(listed.spentMicro, 2_000_000n, "truncates to the intended integer");

    // And a subsequent charge repairs the column.
    store.recordSubscriptionRun({
      subId: sub.id,
      chargedMicro: 1_000_000n,
      nextRunAt: new Date(Date.now() + 864e5).toISOString(),
    });
    assert.equal(store.listSubscriptions(orgId)[0]!.spentMicro, 3_000_000n);
  });
});
