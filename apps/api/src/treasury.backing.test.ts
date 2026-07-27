/**
 * Phase 7 (H3/H4): ledger money must trace to a real event.
 *
 * These tests pin the backing arithmetic — expected on-chain balance is
 * `-(external) - unbacked` — and the mode rule that decides who may mint.
 * They do not touch the network: the one `reconcileOrgOnchain` case exercised
 * here is the vault-unreadable path, which returns before any RPC call.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "pv-backing-"));
process.env.POLICYVAULT_DB = join(dir, "backing.db");

const { store } = await import("./store.js");

after(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

/** Book a simulated deposit the way the sandbox deposit route does. */
function sandboxDeposit(orgId: string, micro: bigint) {
  store.applyEntries(orgId, [
    {
      id: `j_dep_${Math.random().toString(16).slice(2)}`,
      orgId,
      memo: "sandbox_deposit",
      createdAt: new Date().toISOString(),
      lines: [
        { accountId: `org:${orgId}:external`, deltaMicro: -micro },
        { accountId: `org:${orgId}:available`, deltaMicro: micro },
      ],
    },
  ]);
  store.addUnbackedMicro(orgId, micro);
}

describe("ledger mode", () => {
  it("an org seeded with an opening balance is sandbox and expects no on-chain funds", () => {
    const org = store.createOrg("Seeded Co", 100_000_000n);
    assert.equal(store.getOrgLedgerMode(org.id), "sandbox");
    // The opening balance is written straight onto org:available without
    // debiting `external`, so it is already outside the backing arithmetic.
    assert.equal(store.getUnbackedMicro(org.id), 0n);
    // Nothing arrived on-chain, so nothing is expected on-chain.
    assert.equal(store.expectedOnchainMicro(org.id), 0n);
  });

  it("an org that starts empty is live and holds no unbacked money", () => {
    const org = store.createOrg("Live Co", 0n);
    assert.equal(store.getOrgLedgerMode(org.id), "live");
    assert.equal(store.getUnbackedMicro(org.id), 0n);
    assert.equal(store.expectedOnchainMicro(org.id), 0n);
  });

  it("mode is switchable, because a demo org that funds itself for real is now live", () => {
    const org = store.createOrg("Graduating Co", 0n);
    store.setOrgLedgerMode(org.id, "sandbox");
    assert.equal(store.getOrgLedgerMode(org.id), "sandbox");
    store.setOrgLedgerMode(org.id, "live");
    assert.equal(store.getOrgLedgerMode(org.id), "live");
  });
});

describe("expected on-chain balance", () => {
  it("counts a real deposit and ignores a simulated one", () => {
    const org = store.createOrg("Mixed Co", 0n);

    // Real: money actually arrived at the vault.
    store.creditOnchainUsdcDeposit({
      orgId: org.id,
      chain: "base-sepolia",
      txHash: "0xdeadbeef",
      logIndex: 0,
      blockNumber: "1",
      from: "0x1111111111111111111111111111111111111111",
      to: store.getVaultAddress(org.id) ?? "0x0",
      amountMicro: 40_000_000n,
    });
    assert.equal(store.expectedOnchainMicro(org.id), 40_000_000n);

    // Simulated: the books grow, the expectation does not.
    sandboxDeposit(org.id, 10_000_000n);
    assert.equal(store.expectedOnchainMicro(org.id), 40_000_000n);
    assert.equal(store.getUnbackedMicro(org.id), 10_000_000n);
  });

  it("a mock-rail settlement does not reduce what the vault should hold", () => {
    const org = store.createOrg("Mock Co", 0n);
    store.creditOnchainUsdcDeposit({
      orgId: org.id,
      chain: "base-sepolia",
      txHash: "0xfeedface",
      logIndex: 0,
      blockNumber: "1",
      from: "0x2222222222222222222222222222222222222222",
      to: store.getVaultAddress(org.id) ?? "0x0",
      amountMicro: 25_000_000n,
    });

    // The mock rail books an outflow to `external` but moves nothing on-chain.
    store.applyEntries(org.id, [
      {
        id: "j_mock_settle",
        orgId: org.id,
        memo: "mock settlement",
        createdAt: new Date().toISOString(),
        lines: [
          { accountId: `org:${org.id}:available`, deltaMicro: -5_000_000n },
          { accountId: `org:${org.id}:external`, deltaMicro: 5_000_000n },
        ],
      },
    ]);
    store.addUnbackedMicro(org.id, -5_000_000n);

    // The USDC never left, so the vault should still hold the full deposit.
    assert.equal(store.expectedOnchainMicro(org.id), 25_000_000n);
    assert.equal(store.getUnbackedMicro(org.id), -5_000_000n);
  });

  it("a real outflow reduces the expectation by exactly what left", () => {
    const org = store.createOrg("Outflow Co", 0n);
    store.creditOnchainUsdcDeposit({
      orgId: org.id,
      chain: "base-sepolia",
      txHash: "0xabc123",
      logIndex: 0,
      blockNumber: "1",
      from: "0x3333333333333333333333333333333333333333",
      to: store.getVaultAddress(org.id) ?? "0x0",
      amountMicro: 30_000_000n,
    });
    store.applyEntries(org.id, [
      {
        id: "j_real_out",
        orgId: org.id,
        memo: "treasury_withdraw:0x4444444444444444444444444444444444444444",
        createdAt: new Date().toISOString(),
        lines: [
          { accountId: `org:${org.id}:available`, deltaMicro: -12_000_000n },
          { accountId: `org:${org.id}:external`, deltaMicro: 12_000_000n },
        ],
      },
    ]);
    assert.equal(store.expectedOnchainMicro(org.id), 18_000_000n);
  });

  it("a sandbox org that also holds real money reconciles against the real part", () => {
    const org = store.createOrg("Hybrid Co", 50_000_000n);
    assert.equal(store.expectedOnchainMicro(org.id), 0n);
    store.creditOnchainUsdcDeposit({
      orgId: org.id,
      chain: "base-sepolia",
      txHash: "0x999",
      logIndex: 0,
      blockNumber: "1",
      from: "0x5555555555555555555555555555555555555555",
      to: store.getVaultAddress(org.id) ?? "0x0",
      amountMicro: 7_000_000n,
    });
    assert.equal(store.expectedOnchainMicro(org.id), 7_000_000n);
  });
});

describe("reconcileOrgOnchain", () => {
  it("reports a vault it cannot read as unchecked, never as ok", async () => {
    const { reconcileOrgOnchain } = await import("./treasury-backing.js");
    // No vault row, so readVaultOnchain returns before touching the network.
    const report = await reconcileOrgOnchain("org_does_not_exist");
    assert.equal(report.checked, false, "an unreadable vault is not reconciled");
    assert.equal(report.ok, false, "unknown must never present as clean");
    assert.ok(report.error, "the reason must survive to the caller");
    // Drift is not asserted when nothing was compared.
    assert.equal(report.driftMicro, "0");
  });
});

describe("drift", () => {
  it("is the signed difference between the vault and the books", () => {
    const org = store.createOrg("Drift Co", 0n);
    store.creditOnchainUsdcDeposit({
      orgId: org.id,
      chain: "base-sepolia",
      txHash: "0xd1",
      logIndex: 0,
      blockNumber: "1",
      from: "0x6666666666666666666666666666666666666666",
      to: store.getVaultAddress(org.id) ?? "0x0",
      amountMicro: 20_000_000n,
    });

    const expected = store.expectedOnchainMicro(org.id);

    // Money left without the books noticing — the failure C6/P5-T3 guards.
    assert.equal(15_000_000n - expected, -5_000_000n);
    // Money arrived the sweep has not credited yet.
    assert.equal(23_000_000n - expected, 3_000_000n);
    // Agreement.
    assert.equal(20_000_000n - expected, 0n);
  });
});
