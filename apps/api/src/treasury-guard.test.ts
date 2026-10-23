/**
 * Guardian treasury withdrawals go through a policy check.
 *
 * Before this, `/v1/guardian/treasury/withdraw` sent real USDC from the vault
 * after only a balance check: a frozen org could still empty its vault, and
 * the blocklist did not apply to humans. Agents could not bypass the policy
 * engine, but an operator path could — which makes the guard decorative.
 */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "pv-twd-"));
process.env.POLICYVAULT_DB = join(dir, "twd.db");
process.env.ABI_KEY_PEPPER = "test-pepper";
process.env.ABI_NO_LISTEN = "1";
process.env.POLICYVAULT_MOCK_TRANSFER = "1";
process.env.ABI_CHAT_LLM = "0";
process.env.ABI_CHAT_AGENT = "0";
process.env.POLICYVAULT_ALLOW_BOOTSTRAP = "0";

const { store } = await import("./store.js");
const { app } = await import("./index.js");
const { __resetTreasuryGuardForTests, TREASURY_WITHDRAW_TOOL } = await import(
  "./treasury-guard.js"
);

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

beforeEach(() => __resetTreasuryGuardForTests());

const DEST = "0x3333333333333333333333333333333333333333";
const OTHER = "0x4444444444444444444444444444444444444444";

/** Sandbox org (deposit > 0) with $100 in the org treasury. */
function sandboxOrg() {
  return store.createOrg("Treasury Guard Co", 100_000_000n);
}

/** Live org (no mock float) with $100 booked in the treasury. */
function liveOrg() {
  const org = store.createOrg("Live Treasury Co", 0n, { ledgerMode: "live" });
  store.applyEntries(org.id, [
    {
      id: `j_seed_${org.id}`,
      orgId: org.id,
      memo: "onchain_deposit:test",
      createdAt: new Date().toISOString(),
      lines: [
        { accountId: `org:${org.id}:external`, deltaMicro: -100_000_000n },
        { accountId: `org:${org.id}:available`, deltaMicro: 100_000_000n },
      ],
    },
  ]);
  return org;
}

const orgAvailable = (orgId: string) =>
  store.getAccountMap(orgId).get(`org:${orgId}:available`)?.balanceMicro ?? 0n;

type WithdrawBody = {
  ok?: boolean;
  intentId?: string;
  outcome?: string;
  ruleIds?: string[];
  limits?: { ruleId: string; attempted: string; cap: string; used?: string; remaining: string };
  receipt?: { alg?: string; signature?: string };
  error?: { code?: string; message?: string };
};

async function withdraw(guardianKey: string, body: Record<string, unknown>) {
  const res = await fetch(`${base}/v1/guardian/treasury/withdraw`, {
    method: "POST",
    headers: { authorization: `Bearer ${guardianKey}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as WithdrawBody };
}

async function setPolicy(guardianKey: string, body: Record<string, unknown>) {
  const res = await fetch(`${base}/v1/guardian/policy`, {
    method: "POST",
    headers: { authorization: `Bearer ${guardianKey}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe("guardian treasury withdraw guard", () => {
  it("refuses any withdrawal while the org is frozen, and records the decision", async () => {
    const org = sandboxOrg();
    const before = orgAvailable(org.id);
    store.setOrgStatus(org.id, "frozen");
    const r = await withdraw(org.guardianKey, { amountUsdc: "1", destination: DEST });
    assert.equal(r.status, 403);
    assert.equal(r.body.error?.code, "FROZEN");
    assert.deepEqual(r.body.ruleIds, ["org_frozen"]);
    assert.equal(r.body.limits?.remaining, "0");
    assert.equal(r.body.receipt?.alg, "HMAC-SHA256");
    assert.equal(orgAvailable(org.id), before, "frozen withdrawal must not touch the books");
    const decision = store.getDecision(org.id, r.body.intentId!);
    assert.equal(decision?.outcome, "deny");
    assert.equal(decision?.tool, TREASURY_WITHDRAW_TOOL);
    assert.deepEqual(decision?.ruleIds, ["org_frozen"]);
  });

  it("refuses a live withdrawal while frozen before any transfer is attempted", async () => {
    const org = liveOrg();
    store.setOrgStatus(org.id, "frozen");
    const r = await withdraw(org.guardianKey, { amountUsdc: "5", destination: DEST });
    // FROZEN, not a custody / transfer error: the chain path was never reached.
    assert.equal(r.status, 403);
    assert.equal(r.body.error?.code, "FROZEN");
    assert.equal(orgAvailable(org.id), 100_000_000n);
  });

  it("applies the org blocklist to guardian withdrawals", async () => {
    const org = sandboxOrg();
    assert.equal((await setPolicy(org.guardianKey, { blocklist: [DEST] })).status, 200);
    const r = await withdraw(org.guardianKey, { amountUsdc: "1", destination: DEST });
    assert.equal(r.status, 403);
    assert.deepEqual(r.body.ruleIds, ["blocklist"]);
  });

  it("enforces a destination allowlist when one is configured", async () => {
    const org = sandboxOrg();
    const saved = await setPolicy(org.guardianKey, { treasuryWithdrawAllowlist: [DEST] });
    assert.equal(saved.status, 200);
    const miss = await withdraw(org.guardianKey, { amountUsdc: "1", destination: OTHER });
    assert.equal(miss.status, 403);
    assert.deepEqual(miss.body.ruleIds, ["treasury_withdraw_allowlist"]);
    const none = await withdraw(org.guardianKey, { amountUsdc: "1" });
    assert.equal(none.status, 403, "no destination cannot satisfy an allowlist");
    const hit = await withdraw(org.guardianKey, { amountUsdc: "1", destination: DEST });
    assert.equal(hit.status, 200);
    assert.equal(hit.body.ok, true);
  });

  it("enforces the per-withdrawal cap with the numbers that bound", async () => {
    const org = sandboxOrg();
    const saved = await setPolicy(org.guardianKey, { treasuryWithdrawMaxUsdc: "10" });
    assert.equal(saved.status, 200);
    const over = await withdraw(org.guardianKey, { amountUsdc: "10.01", destination: DEST });
    assert.equal(over.status, 403);
    assert.deepEqual(over.body.ruleIds, ["treasury_withdraw_max"]);
    assert.equal(over.body.limits?.cap, "10");
    assert.equal(over.body.limits?.attempted, "10.01");
    const ok = await withdraw(org.guardianKey, { amountUsdc: "10", destination: DEST });
    assert.equal(ok.status, 200);
    assert.equal(orgAvailable(org.id), 90_000_000n);
    assert.equal(store.getDecision(org.id, ok.body.intentId!)?.outcome, "allow");
  });

  it("enforces a rolling 24h cap across withdrawals and reports what remains", async () => {
    const org = sandboxOrg();
    const saved = await setPolicy(org.guardianKey, {
      treasuryWithdrawMaxUsdc: "10",
      treasuryWithdrawDailyMaxUsdc: "15",
    });
    assert.equal(saved.status, 200);
    assert.equal((await withdraw(org.guardianKey, { amountUsdc: "10" })).status, 200);
    const over = await withdraw(org.guardianKey, { amountUsdc: "6" });
    assert.equal(over.status, 403);
    assert.deepEqual(over.body.ruleIds, ["treasury_withdraw_daily_max"]);
    assert.equal(over.body.limits?.used, "10");
    assert.equal(over.body.limits?.remaining, "5");
    assert.equal((await withdraw(org.guardianKey, { amountUsdc: "5" })).status, 200);
    assert.equal(orgAvailable(org.id), 85_000_000n);
  });

  it("applies a conservative default cap when none is configured", async () => {
    const org = store.createOrg("Big Float Co", 10_000_000_000n); // $10,000 sandbox
    const r = await withdraw(org.guardianKey, { amountUsdc: "1000.01" });
    assert.equal(r.status, 403);
    assert.deepEqual(r.body.ruleIds, ["treasury_withdraw_max"]);
    assert.equal(r.body.limits?.cap, "1000");
  });

  it("rejects non-positive or inverted cap configuration", async () => {
    const org = sandboxOrg();
    assert.equal((await setPolicy(org.guardianKey, { treasuryWithdrawMaxUsdc: "0" })).status, 400);
    assert.equal(
      (
        await setPolicy(org.guardianKey, {
          treasuryWithdrawMaxUsdc: "20",
          treasuryWithdrawDailyMaxUsdc: "10",
        })
      ).status,
      400,
    );
  });
});
