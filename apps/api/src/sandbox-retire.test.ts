/**
 * Sandbox mode was removed. Every new org starts live, and orgs still on
 * sandbox books are moved to live with their simulated balance written off
 * (journal memo `sandbox_writeoff:*`), atomically and without anything being
 * sent on-chain.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import Database from "better-sqlite3";

const dir = mkdtempSync(join(tmpdir(), "pv-sandbox-retire-"));
process.env.POLICYVAULT_DB = join(dir, "retire.db");
process.env.ABI_KEY_PEPPER = "test-pepper";
process.env.ABI_KEK = Buffer.alloc(32, 7).toString("base64");
process.env.CHAIN = "base-sepolia";

const { store, migrateSandboxOrgsToLive } = await import("./store.js");
const { hashPassword } = await import("./auth/password.js");

after(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

function raw() {
  return new Database(process.env.POLICYVAULT_DB!);
}

/** Recreate what a production sandbox org looked like before retirement. */
function legacySandbox(orgId: string, simulatedMicro: bigint) {
  const db = raw();
  db.prepare("UPDATE orgs SET ledger_mode = 'sandbox' WHERE id = ?").run(orgId);
  db.close();
  store.applyEntries(orgId, [
    {
      id: `j_sim_${orgId}`,
      orgId,
      memo: "sandbox_deposit",
      createdAt: new Date().toISOString(),
      lines: [
        { accountId: `org:${orgId}:external`, deltaMicro: -simulatedMicro },
        { accountId: `org:${orgId}:available`, deltaMicro: simulatedMicro },
      ],
    },
  ]);
  store.addUnbackedMicro(orgId, simulatedMicro);
}

function realDeposit(orgId: string, micro: bigint) {
  store.applyEntries(orgId, [
    {
      id: `j_real_${orgId}_${micro}`,
      orgId,
      memo: "onchain_deposit:0xabc",
      createdAt: new Date().toISOString(),
      lines: [
        { accountId: `org:${orgId}:external`, deltaMicro: -micro },
        { accountId: `org:${orgId}:available`, deltaMicro: micro },
      ],
    },
  ]);
}

const avail = (orgId: string) =>
  store.getAccountMap(orgId).get(`org:${orgId}:available`)?.balanceMicro ?? 0n;

describe("sandbox retirement", () => {
  it("new buyer, signup and seller orgs start live", async () => {
    const buyer = store.createOrg("Buyer Co", 0n);
    const created = store.createAccountWithOrg({
      email: `live-${Date.now()}@example.com`,
      name: "Live User",
      orgName: "Live Co",
      passwordHash: await hashPassword("correct-horse-battery"),
      verificationToken: "tok-live",
      verificationTtlMs: 60_000,
      markEmailVerified: true,
    });
    assert.equal(created.status, "created");
    if (created.status !== "created") return;
    assert.ok(created.user.emailVerifiedAt);
    const partner = store.createPartnerAccountWithOrg({
      email: `seller-${Date.now()}@example.com`,
      name: "Seller",
      passwordHash: await hashPassword("correct-horse-battery"),
      companyName: "Seller Co",
    });
    const sandbox = store.listSandboxOrgIds();
    for (const id of [buyer.id, created.orgId, partner.org.id]) {
      assert.ok(!sandbox.includes(id), `${id} should be live`);
    }
  });

  it("migration moves a sandbox org with 10,000 simulated USDC to live and keeps real money", () => {
    const org = store.createOrg("Legacy Sandbox Co", 0n);
    legacySandbox(org.id, 10_000_000_000n);
    realDeposit(org.id, 5_000_000n); // 5 USDC that really arrived on-chain
    const expectedBefore = store.expectedOnchainMicro(org.id);
    assert.equal(expectedBefore, 5_000_000n);

    // Part of the simulated money was handed to a budget, as users did.
    const dept = store.createDepartment(org.id, "Ops");
    const deptAccount = [...store.getAccountMap(org.id).values()].find(
      (a) => a.kind === "dept_available",
    );
    assert.ok(deptAccount, `department ${dept.id} has an available account`);
    store.applyEntries(org.id, [
      {
        id: "j_alloc",
        orgId: org.id,
        memo: "budget_allocate",
        createdAt: new Date().toISOString(),
        lines: [
          { accountId: `org:${org.id}:available`, deltaMicro: -10_003_000_000n },
          { accountId: deptAccount.id, deltaMicro: 10_003_000_000n },
        ],
      },
    ]);
    // A typed-in (simulated) EURC holding.
    store.creditOrgAsset(org.id, "asset_eurc", 250_000_000n);

    const migrated = migrateSandboxOrgsToLive();
    const row = migrated.find((m) => m.orgId === org.id);
    assert.ok(row);
    assert.equal(row.writtenOffMicro, 10_000_000_000n);
    assert.equal(row.remainingUnbackedMicro, 0n);

    assert.ok(!store.listSandboxOrgIds().includes(org.id));
    assert.equal(store.getUnbackedMicro(org.id), 0n);
    // Only the real 5 USDC is left on the books, and the books still match the chain.
    const balances = [...store.getAccountMap(org.id).values()]
      .filter((a) => a.kind !== "external" && a.kind !== "revenue")
      .reduce((sum, a) => sum + a.balanceMicro, 0n);
    assert.equal(balances, 5_000_000n);
    assert.equal(store.expectedOnchainMicro(org.id), expectedBefore);
    assert.equal(store.getOrgAssetBalance(org.id, "asset_eurc"), 0n);
    const writeoff = store
      .listJournals(org.id, 50)
      .filter((j) => j.memo === "sandbox_writeoff:migration");
    assert.equal(writeoff.length, 1);
    const events = store.listVaultAssetEvents(org.id);
    assert.ok(events.some((e) => e.memo === "sandbox_writeoff:migration" && e.kind === "out"));
    assert.equal(store.reconcileOrg(org.id).ok, true);

    // Running again changes nothing.
    assert.equal(
      migrateSandboxOrgsToLive().some((m) => m.orgId === org.id),
      false,
    );
    const second = store.retireSandbox(org.id, { actor: "test", reason: "go_live" });
    assert.equal(second.changed, false);
    assert.equal(
      store.listJournals(org.id, 50).filter((j) => j.memo.startsWith("sandbox_writeoff:")).length,
      1,
    );
  });

  it("money locked in a hold stays counted as unbacked instead of breaking the payment", () => {
    const org = store.createOrg("Held Co", 0n);
    legacySandbox(org.id, 100_000_000n);
    const agent = store.createAgent(org.id, "Agent");
    const accounts = [...store.getAccountMap(org.id).values()];
    const held = accounts.find((a) => a.kind === "agent_held");
    assert.ok(held, `agent ${agent.agentId} has a held account`);
    store.applyEntries(org.id, [
      {
        id: "j_hold",
        orgId: org.id,
        memo: "hold",
        createdAt: new Date().toISOString(),
        lines: [
          { accountId: `org:${org.id}:available`, deltaMicro: -30_000_000n },
          { accountId: held.id, deltaMicro: 30_000_000n },
        ],
      },
    ]);
    const r = store.retireSandbox(org.id, { actor: "owner", reason: "go_live" });
    assert.equal(r.changed, true);
    assert.equal(r.writtenOffMicro, 70_000_000n);
    assert.equal(r.remainingUnbackedMicro, 30_000_000n);
    assert.equal(store.getUnbackedMicro(org.id), 30_000_000n);
    assert.equal(avail(org.id), 0n);
    assert.ok(!store.listSandboxOrgIds().includes(org.id));
    assert.equal(store.reconcileOrg(org.id).ok, true);
  });

  it("is atomic: a failure leaves the org untouched", () => {
    const org = store.createOrg("Atomic Co", 0n);
    legacySandbox(org.id, 50_000_000n);
    store.creditOrgAsset(org.id, "asset_eurc", 1_000_000n);
    const journalsBefore = store.listJournals(org.id, 50).length;
    // Fail after the USDC write-off journal was written.
    const original = store.addVaultAssetEvent.bind(store);
    store.addVaultAssetEvent = () => {
      throw new Error("disk full");
    };
    try {
      assert.throws(() => store.retireSandbox(org.id, { actor: "owner", reason: "go_live" }));
    } finally {
      store.addVaultAssetEvent = original;
    }
    assert.equal(store.listJournals(org.id, 50).length, journalsBefore);
    assert.equal(store.getOrgAssetBalance(org.id, "asset_eurc"), 1_000_000n);
    assert.ok(store.listSandboxOrgIds().includes(org.id));
    assert.equal(store.getUnbackedMicro(org.id), 50_000_000n);
    assert.equal(avail(org.id), 50_000_000n);
  });
});
