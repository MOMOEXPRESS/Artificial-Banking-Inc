import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  allocateStipend,
  applyJournal,
  lockEscrow,
  recogniseRevenue,
  refundEscrow,
  releaseEscrow,
  type LedgerAccount,
} from "./index.js";

describe("ledger", () => {
  it("allocates stipend with balanced journal", () => {
    const accounts = new Map<string, LedgerAccount>([
      [
        "org_av",
        {
          id: "org_av",
          orgId: "org1",
          kind: "org_available",
          balanceMicro: 100_000_000n,
        },
      ],
      [
        "agt_av",
        {
          id: "agt_av",
          orgId: "org1",
          kind: "agent_available",
          agentId: "a1",
          balanceMicro: 0n,
        },
      ],
    ]);
    const { apply } = allocateStipend({
      orgId: "org1",
      journalId: "j1",
      orgAvailableId: "org_av",
      agentAvailableId: "agt_av",
      amountMicro: 40_000_000n,
    });
    const next = apply(accounts);
    assert.equal(next.get("org_av")!.balanceMicro, 60_000_000n);
    assert.equal(next.get("agt_av")!.balanceMicro, 40_000_000n);
  });

  it("rejects insufficient funds", () => {
    const accounts = new Map<string, LedgerAccount>([
      [
        "org_av",
        {
          id: "org_av",
          orgId: "org1",
          kind: "org_available",
          balanceMicro: 1n,
        },
      ],
      [
        "agt_av",
        {
          id: "agt_av",
          orgId: "org1",
          kind: "agent_available",
          agentId: "a1",
          balanceMicro: 0n,
        },
      ],
    ]);
    assert.throws(() =>
      applyJournal(accounts, {
        id: "j2",
        orgId: "org1",
        memo: "bad",
        lines: [
          { accountId: "org_av", deltaMicro: -10n },
          { accountId: "agt_av", deltaMicro: 10n },
        ],
      }),
    );
  });

  function escrowFixture() {
    return new Map<string, LedgerAccount>([
      [
        "payer_av",
        { id: "payer_av", orgId: "org1", kind: "agent_available", agentId: "a1", balanceMicro: 10_000_000n },
      ],
      [
        "payee_av",
        { id: "payee_av", orgId: "org1", kind: "agent_available", agentId: "a2", balanceMicro: 0n },
      ],
      [
        "esc_1",
        { id: "esc_1", orgId: "org1", kind: "escrow", balanceMicro: 0n },
      ],
    ]);
  }

  it("locks then releases escrow to payee", () => {
    let m = escrowFixture();
    m = applyJournal(
      m,
      lockEscrow({
        orgId: "org1",
        journalId: "jl",
        payerAvailableId: "payer_av",
        escrowAccountId: "esc_1",
        amountMicro: 5_000_000n,
      }),
    );
    assert.equal(m.get("payer_av")!.balanceMicro, 5_000_000n);
    assert.equal(m.get("esc_1")!.balanceMicro, 5_000_000n);
    m = applyJournal(
      m,
      releaseEscrow({
        orgId: "org1",
        journalId: "jr",
        escrowAccountId: "esc_1",
        payeeAvailableId: "payee_av",
        amountMicro: 5_000_000n,
      }),
    );
    assert.equal(m.get("esc_1")!.balanceMicro, 0n);
    assert.equal(m.get("payee_av")!.balanceMicro, 5_000_000n);
  });

  it("locks then refunds escrow to payer on timeout", () => {
    let m = escrowFixture();
    m = applyJournal(
      m,
      lockEscrow({
        orgId: "org1",
        journalId: "jl2",
        payerAvailableId: "payer_av",
        escrowAccountId: "esc_1",
        amountMicro: 4_000_000n,
      }),
    );
    m = applyJournal(
      m,
      refundEscrow({
        orgId: "org1",
        journalId: "jf",
        escrowAccountId: "esc_1",
        payerAvailableId: "payer_av",
        amountMicro: 4_000_000n,
        reason: "timeout_refund",
      }),
    );
    assert.equal(m.get("payer_av")!.balanceMicro, 10_000_000n);
    assert.equal(m.get("esc_1")!.balanceMicro, 0n);
    assert.equal(m.get("payee_av")!.balanceMicro, 0n);
  });

  it("recognises invoice revenue as a credit balance", () => {
    const m = new Map<string, LedgerAccount>([
      ["org_av", { id: "org_av", orgId: "org1", kind: "org_available", balanceMicro: 0n }],
      ["rev", { id: "rev", orgId: "org1", kind: "revenue", balanceMicro: 0n }],
    ]);
    const next = applyJournal(
      m,
      recogniseRevenue({
        orgId: "org1",
        journalId: "jrev",
        revenueAccountId: "rev",
        orgAvailableId: "org_av",
        amountMicro: 250_000_000n,
      }),
    );
    // Cash up, revenue carries the matching credit — books still sum to zero.
    assert.equal(next.get("org_av")!.balanceMicro, 250_000_000n);
    assert.equal(next.get("rev")!.balanceMicro, -250_000_000n);
  });

  it("still refuses to overdraw an asset account", () => {
    const m = new Map<string, LedgerAccount>([
      ["org_av", { id: "org_av", orgId: "org1", kind: "org_available", balanceMicro: 5n }],
      ["ext", { id: "ext", orgId: "org1", kind: "external", balanceMicro: 0n }],
    ]);
    assert.throws(() =>
      applyJournal(m, {
        id: "j",
        orgId: "org1",
        memo: "overdraw",
        lines: [
          { accountId: "org_av", deltaMicro: -6n },
          { accountId: "ext", deltaMicro: 6n },
        ],
      }),
    );
  });

  it("rejects escrow lock beyond available balance", () => {
    const m = escrowFixture();
    assert.throws(() =>
      applyJournal(
        m,
        lockEscrow({
          orgId: "org1",
          journalId: "jl3",
          payerAvailableId: "payer_av",
          escrowAccountId: "esc_1",
          amountMicro: 11_000_000n,
        }),
      ),
    );
  });
});
