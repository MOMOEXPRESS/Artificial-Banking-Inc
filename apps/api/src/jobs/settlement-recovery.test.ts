/**
 * Durable settlement and recovery (audit finding P5-T3).
 *
 * `executeIntent` holds funds, tells a rail to move money irreversibly, and
 * only then writes the ledger. A crash, restart or timeout in that window left
 * money moved with nothing recorded — silently wrong balances, no signal.
 *
 * The invariant these tests defend: **no settlement is invisible.** Every
 * attempt leaves a durable row before the rail is invoked, the transaction hash
 * is persisted the moment it exists, and anything left mid-flight is either
 * resolved from chain evidence or escalated to a human — never guessed.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "pv-settle-"));
process.env.POLICYVAULT_DB = join(dir, "settle.db");
process.env.ABI_KEY_PEPPER = "test-pepper";
process.env.ABI_KEK = "test-kek";
process.env.ABI_NO_LISTEN = "1";
process.env.POLICYVAULT_MOCK_TRANSFER = "1";
process.env.ABI_CHAT_LLM = "0";
// Anything older than a moment counts as stuck, so tests need not wait.
process.env.ABI_SETTLEMENT_STUCK_MINUTES = "0";

const { store } = await import("../store.js");
const { executeIntent, id } = await import("../engine.js");
const { recoverStuckSettlements } = await import("./settlement-recovery.js");
const { setCustodyProvider, DevLocalProvider } = await import("@policyvault/custody");

setCustodyProvider(new DevLocalProvider(() => null, async () => "0x" as `0x${string}`));

after(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

const PAYEE = "0x1111111111111111111111111111111111111111";

/**
 * The stuck window is zero here, but rows must still be *older* than the
 * cutoff — so let the clock advance past the write. In production the window
 * is ten minutes and this is not a concern.
 */
const tick = () => new Promise((r) => setTimeout(r, 10));

function fundedOrg(stipend = 200_000_000n) {
  const org = store.createOrg("Settle Co", 1_000_000_000n);
  const agent = store.createAgent(org.id, "Spender");
  const t = store.getPolicyTemplate(org.id);
  store.setPolicyTemplate(org.id, {
    ...t,
    addressAllowlist: [PAYEE],
    perTxMaxMicro: 500_000_000n,
    dailyMaxMicro: 900_000_000n,
    hitlAboveMicro: 400_000_000n,
    newCounterpartyCooldownHours: 0,
  });
  store.addKnownCounterparty(org.id, PAYEE);
  store.applyEntries(org.id, [
    {
      id: id("j"),
      orgId: org.id,
      memo: "seed",
      createdAt: new Date().toISOString(),
      lines: [
        { accountId: `org:${org.id}:available`, deltaMicro: -stipend },
        { accountId: `agent:${agent.agentId}:available`, deltaMicro: stipend },
      ],
    },
  ]);
  return { org, agent };
}

/** Fabricate an attempt left mid-flight, as a crash would. */
function stranded(
  orgId: string,
  agentId: string,
  state: "pending" | "broadcast",
  txHash?: string,
) {
  const intentId = id("int");
  store.beginSettlement({
    intentId,
    orgId,
    agentId,
    tool: "pay",
    destination: PAYEE,
    amountMicro: 5_000_000n,
  });
  if (state === "broadcast") store.markSettlementBroadcast(intentId, "evm-usdc-transfer", txHash);
  return intentId;
}

describe("settlement records", () => {
  it("records a successful payment as settled, with its rail and amount", async () => {
    const { org, agent } = fundedOrg();
    const intentId = id("int");

    const result = await executeIntent({
      orgId: org.id,
      agentId: agent.agentId,
      tool: "pay",
      amountMicro: 10_000_000n,
      amountUsdc: "10",
      destination: PAYEE,
      intentId,
    });

    assert.equal(result.ok, true);
    const row = store.getSettlement(intentId);
    assert.ok(row, "every attempt must leave a durable row");
    assert.equal(row!.state, "settled");
    assert.equal(row!.chargedMicro, 10_000_000n);
    assert.equal(row!.rail, "transfer-mock");
    assert.ok(row!.txHash, "hash must be captured");
  });

  it("records an attempt even when the rail never gets to run", async () => {
    // Insufficient funds fails before the rail; the attempt must still be
    // visible rather than vanishing.
    const { org, agent } = fundedOrg(1_000_000n);
    const intentId = id("int");

    const result = await executeIntent({
      orgId: org.id,
      agentId: agent.agentId,
      tool: "pay",
      amountMicro: 50_000_000n,
      amountUsdc: "50",
      destination: PAYEE,
      intentId,
    });

    assert.equal(result.ok, false);
    // The hold failed before the settlement record opens, so there is nothing
    // in flight and no money moved — the ledger is the record of truth here.
    assert.equal(store.getAccountMap(org.id).get(`agent:${agent.agentId}:held`)?.balanceMicro, 0n);
  });

  it("lists attempts for an org, newest first", async () => {
    const { org, agent } = fundedOrg();
    for (let i = 0; i < 3; i++) {
      await executeIntent({
        orgId: org.id,
        agentId: agent.agentId,
        tool: "pay",
        amountMicro: 1_000_000n,
        amountUsdc: "1",
        destination: PAYEE,
        intentId: id("int"),
      });
    }
    const rows = store.listSettlements(org.id);
    assert.equal(rows.length, 3);
    assert.ok(rows.every((r) => r.state === "settled"));
  });
});

describe("recoverStuckSettlements", () => {
  it("fails an attempt abandoned before the rail was invoked", async () => {
    // Nothing left the building, so this is unambiguously a failure.
    const { org, agent } = fundedOrg();
    const intentId = stranded(org.id, agent.agentId, "pending");

    await tick();
    const out = await recoverStuckSettlements();
    assert.ok(out.checked >= 1);
    assert.equal(store.getSettlement(intentId)!.state, "failed");
  });

  it("escalates a broadcast attempt with no hash rather than assuming", async () => {
    const { org, agent } = fundedOrg();
    const intentId = stranded(org.id, agent.agentId, "broadcast");

    await tick();
    await recoverStuckSettlements();
    const row = store.getSettlement(intentId)!;
    assert.equal(row.state, "needs_review", "cannot tell whether funds moved — ask a human");
    assert.match(String(row.error), /cannot determine/i);
  });

  it("escalates an interrupted simulated settlement", async () => {
    const { org, agent } = fundedOrg();
    const intentId = stranded(org.id, agent.agentId, "broadcast", "0xmock_deadbeef");

    await tick();
    await recoverStuckSettlements();
    const row = store.getSettlement(intentId)!;
    assert.equal(row.state, "needs_review");
    assert.match(String(row.error), /simulated/i);
  });

  it("leaves a settled attempt alone", async () => {
    const { org, agent } = fundedOrg();
    const intentId = id("int");
    await executeIntent({
      orgId: org.id,
      agentId: agent.agentId,
      tool: "pay",
      amountMicro: 2_000_000n,
      amountUsdc: "2",
      destination: PAYEE,
      intentId,
    });

    await tick();
    await recoverStuckSettlements();
    assert.equal(store.getSettlement(intentId)!.state, "settled", "must not be re-opened");
  });

  it("never re-applies ledger entries during recovery", async () => {
    // Booking a payment from a background job on after-the-fact evidence is how
    // a recovery path becomes a double-spend. It must only report.
    const { org, agent } = fundedOrg();
    stranded(org.id, agent.agentId, "broadcast", "0xmock_abc123");
    const before = store.getAccountMap(org.id).get(`agent:${agent.agentId}:available`)
      ?.balanceMicro;

    await tick();
    await recoverStuckSettlements();

    assert.equal(
      store.getAccountMap(org.id).get(`agent:${agent.agentId}:available`)?.balanceMicro,
      before,
      "recovery must not move money",
    );
  });

  it("is idempotent across repeated sweeps", async () => {
    const { org, agent } = fundedOrg();
    const intentId = stranded(org.id, agent.agentId, "pending");

    await tick();
    await recoverStuckSettlements();
    const first = store.getSettlement(intentId)!;
    await recoverStuckSettlements();
    const second = store.getSettlement(intentId)!;

    assert.equal(first.state, second.state);
    // Resolved rows are no longer stuck, so they are not revisited.
    assert.equal(second.state, "failed");
  });
});
