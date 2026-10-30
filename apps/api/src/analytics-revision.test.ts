/**
 * Derived caches must follow writes even when the database handle is swapped.
 *
 * On Cloudflare Workers the Durable Object injects a fresh SqlStorage adapter
 * on every request (`globalThis.__ABI_STORE_DB__`). The revision hook used to
 * be installed on the first handle only, so writes through every later handle
 * never bumped the revision and Insights (vendors, burn, anomalies, economics)
 * and metrics served the first request's numbers until the object restarted.
 *
 * This test reproduces that: it injects one handle, reads, swaps to a second
 * handle on the same file (as the Worker does), writes, and reads again.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import Database from "better-sqlite3";

const dir = mkdtempSync(join(tmpdir(), "pv-anrev-"));
const file = join(dir, "anrev.db");
process.env.POLICYVAULT_DB = file;
process.env.ABI_KEY_PEPPER = "test-pepper";
process.env.ABI_NO_LISTEN = "1";
process.env.POLICYVAULT_MOCK_TRANSFER = "1";

type G = { __ABI_STORE_DB__?: unknown };
const handles: Database.Database[] = [];
function inject(): void {
  const h = new Database(file);
  handles.push(h);
  (globalThis as G).__ABI_STORE_DB__ = h;
}
inject();

const { store, currentRevision } = await import("./store.js");
const { vendorLedger, burnForecast, anomalies, storedMicro } = await import("./analytics.js");

after(() => {
  delete (globalThis as G).__ABI_STORE_DB__;
  for (const h of handles) {
    try {
      h.close();
    } catch {
      /* already closed */
    }
  }
  rmSync(dir, { recursive: true, force: true });
});

let n = 0;
function decide(orgId: string, agentId: string, amountUsdc: string, destination: string) {
  n += 1;
  store.addDecision({
    intentId: `int_anrev_${n}`,
    orgId,
    agentId,
    outcome: "allow",
    ruleIds: [],
    reasons: [],
    tool: "pay_api",
    amountUsdc,
    destination,
    at: new Date(Date.now() - n * 1000).toISOString(),
  } as Parameters<typeof store.addDecision>[0]);
}

describe("analytics caches across Durable Object handle swaps", () => {
  it("a write through a newly injected handle bumps the revision and refreshes vendors/burn", () => {
    const org = store.createOrg("Revision Co", 100_000_000n);
    const agent = store.createAgent(org.id, "Scout");
    decide(org.id, agent.agentId, "1.5", "https://api.vendor-a.test/x");

    const first = vendorLedger(org.id);
    assert.equal(first.vendors.length, 1);
    assert.equal(first.vendors[0].payments, 1);

    // The Worker re-binds a fresh adapter for the next request.
    inject();
    const rev = currentRevision();
    decide(org.id, agent.agentId, "2.5", "https://api.vendor-b.test/y");
    assert.ok(currentRevision() > rev, "write through the new handle must bump the revision");

    const second = vendorLedger(org.id);
    assert.deepEqual(second.vendors.map((v) => v.vendor).sort(), [
      "api.vendor-a.test",
      "api.vendor-b.test",
    ]);
    const burn = burnForecast(org.id);
    assert.equal(burn.perAgent.find((p) => p.agentId === agent.agentId)?.spentTodayUsdc, "4");
  });

  it("re-injecting the same handle does not double-wrap (one bump per write)", () => {
    const org = store.createOrg("Single Wrap Co", 1_000_000n);
    const agent = store.createAgent(org.id, "Solo");
    // Same handle injected again — must stay a single wrap.
    (globalThis as G).__ABI_STORE_DB__ = handles[handles.length - 1];
    const rev = currentRevision();
    decide(org.id, agent.agentId, "1", "https://api.solo.test/");
    assert.equal(currentRevision() - rev, 1);
  });
});

describe("analytics tolerate rows they cannot parse", () => {
  it("storedMicro reads valid amounts and treats unreadable ones as zero", () => {
    assert.equal(storedMicro("1.25"), 1_250_000n);
    assert.equal(storedMicro(" 3"), 3_000_000n);
    assert.equal(storedMicro("1.1234567"), 0n);
    assert.equal(storedMicro(null), 0n);
    assert.equal(storedMicro("abc"), 0n);
  });

  it("vendors, burn and anomalies still answer when one decision row is malformed", () => {
    const org = store.createOrg("Messy Rows Co", 100_000_000n);
    const agent = store.createAgent(org.id, "Messy");
    decide(org.id, agent.agentId, "1", "https://api.ok.test/a");
    decide(org.id, agent.agentId, "2", "https://api.ok.test/b");
    decide(org.id, agent.agentId, "1.1234567", "https://api.odd.test/c");
    decide(org.id, agent.agentId, "3", "");
    assert.doesNotThrow(() => vendorLedger(org.id));
    assert.doesNotThrow(() => burnForecast(org.id));
    assert.doesNotThrow(() => anomalies(org.id));
    const ok = vendorLedger(org.id).vendors.find((v) => v.vendor === "api.ok.test");
    assert.equal(ok?.totalUsdc, "3");
  });

  it("counts payments within five minutes per agent (binary-search window)", () => {
    const org = store.createOrg("Burst Co", 100_000_000n);
    const a = store.createAgent(org.id, "Burst");
    const b = store.createAgent(org.id, "Calm");
    const t0 = Date.now() - 60 * 60_000;
    const add = (agentId: string, offsetMs: number, amt = "1") => {
      n += 1;
      store.addDecision({
        intentId: `int_burst_${n}`,
        orgId: org.id,
        agentId,
        outcome: "allow",
        ruleIds: [],
        reasons: [],
        tool: "pay_api",
        amountUsdc: amt,
        destination: "https://api.burst.test/",
        at: new Date(t0 + offsetMs).toISOString(),
      } as Parameters<typeof store.addDecision>[0]);
    };
    for (let i = 0; i < 6; i++) add(a.agentId, i * 10_000);
    add(b.agentId, 5_000);
    add(b.agentId, 20 * 60_000);
    const res = anomalies(org.id);
    const burst = res.anomalies.filter((x) => x.agentName === "Burst");
    assert.ok(
      burst.some((x) => x.signals.some((s) => /6 payments from this agent within 5 minutes/.test(s))),
      JSON.stringify(res.anomalies.map((x) => [x.agentName, x.signals])),
    );
    assert.ok(
      !res.anomalies.some(
        (x) => x.agentName === "Calm" && x.signals.some((s) => /within 5 minutes/.test(s)),
      ),
    );
  });
});
