/**
 * Money-path regression suite.
 *
 * These are the guarantees the README advertises and the ones the audit found
 * were real in source but unprotected by any test — the ~900 most
 * security-critical lines had zero coverage. The storage layer beneath them
 * changes in Phase 2, so these exist to prove the behaviour survives it.
 *
 * Each test names the failure it prevents, not just the feature it exercises.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "pv-money-"));
process.env.POLICYVAULT_DB = join(dir, "money.db");
process.env.ABI_KEY_PEPPER = "test-pepper";
process.env.ABI_NO_LISTEN = "1";
// Keep every rail local: `pay` to a 0x address would otherwise broadcast.
process.env.POLICYVAULT_MOCK_TRANSFER = "1";
process.env.ABI_CHAT_LLM = "0";

const { store } = await import("./store.js");
const { executeIntent, resolveApproval, settleEscrow, rulesFor, id } = await import("./engine.js");
const { setCustodyProvider, DevLocalProvider } = await import("@policyvault/custody");

// The engine asks for a custody provider on the escrow/compliance path.
setCustodyProvider(new DevLocalProvider(() => null, async () => "0x" as `0x${string}`));

after(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

const PAYEE = "0x1111111111111111111111111111111111111111";

/** A funded org with one agent, an allowlisted payee, and generous bands. */
function freshOrg(opts: { stipendUsdc?: bigint; perTxMax?: bigint; hitlAbove?: bigint } = {}) {
  const org = store.createOrg("Money Path Co", 1_000_000_000n);
  const agent = store.createAgent(org.id, "Spender");
  const t = store.getPolicyTemplate(org.id);
  store.setPolicyTemplate(org.id, {
    ...t,
    addressAllowlist: [PAYEE],
    perTxMaxMicro: opts.perTxMax ?? 100_000_000n,
    dailyMaxMicro: 500_000_000n,
    hitlAboveMicro: opts.hitlAbove ?? 50_000_000n,
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
        { accountId: `org:${org.id}:available`, deltaMicro: -(opts.stipendUsdc ?? 200_000_000n) },
        { accountId: `agent:${agent.agentId}:available`, deltaMicro: opts.stipendUsdc ?? 200_000_000n },
      ],
    },
  ]);
  return { org, agent };
}

const bal = (orgId: string, accountId: string) =>
  store.getAccountMap(orgId).get(accountId)?.balanceMicro ?? 0n;

describe("executeIntent — hold, settle, release", () => {
  it("moves exactly the charged amount and leaves no hold behind", async () => {
    const { org, agent } = freshOrg();
    const before = bal(org.id, `agent:${agent.agentId}:available`);

    const result = await executeIntent({
      orgId: org.id,
      agentId: agent.agentId,
      tool: "pay",
      amountMicro: 10_000_000n,
      amountUsdc: "10",
      destination: PAYEE,
      intentId: id("int"),
    });

    assert.equal(result.ok, true);
    assert.equal(bal(org.id, `agent:${agent.agentId}:available`), before - 10_000_000n);
    // A leaked hold silently freezes an agent's funds forever.
    assert.equal(bal(org.id, `agent:${agent.agentId}:held`), 0n, "hold must be fully cleared");
  });

  it("refuses to overspend the stipend and releases the hold", async () => {
    const { org, agent } = freshOrg({ stipendUsdc: 5_000_000n });

    const result = await executeIntent({
      orgId: org.id,
      agentId: agent.agentId,
      tool: "pay",
      amountMicro: 40_000_000n,
      amountUsdc: "40",
      destination: PAYEE,
      intentId: id("int"),
    });

    assert.equal(result.ok, false);
    assert.equal(bal(org.id, `agent:${agent.agentId}:available`), 5_000_000n, "balance untouched");
    assert.equal(bal(org.id, `agent:${agent.agentId}:held`), 0n, "no orphaned hold");
  });

  it("keeps the org's books balanced after a settlement", async () => {
    const { org, agent } = freshOrg();
    await executeIntent({
      orgId: org.id,
      agentId: agent.agentId,
      tool: "pay",
      amountMicro: 7_500_000n,
      amountUsdc: "7.5",
      destination: PAYEE,
      intentId: id("int"),
    });
    // Genesis replay must agree with stored balances, or the ledger is lying.
    const recon = store.reconcileOrgUncached(org.id);
    assert.equal(recon.ok, true, JSON.stringify(recon.drift));
  });
});

describe("resolveApproval — a guardian cannot waive a hard limit", () => {
  /** Park a payment above the HITL threshold and return the approval row. */
  function parkedApproval(orgId: string, agentId: string, amountMicro: bigint) {
    const approval = {
      id: id("apr"),
      orgId,
      agentId,
      intentId: id("int"),
      tool: "pay",
      amountMicro,
      amountUsdc: String(Number(amountMicro) / 1e6),
      destination: PAYEE,
      idempotencyKey: `park_${id("k")}`,
      ruleIds: ["hitl_above"],
      reasons: ["Amount requires human approval"],
      status: "pending" as const,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    };
    store.createApproval(approval);
    return approval;
  }

  it("executes an approval that is still within policy", async () => {
    const { org, agent } = freshOrg();
    const approval = parkedApproval(org.id, agent.agentId, 60_000_000n);

    const outcome = await resolveApproval(org.id, approval.id, true, "alice");

    assert.equal(outcome.kind, "resolved");
    assert.equal(bal(org.id, `agent:${agent.agentId}:available`), 140_000_000n);
  });

  it("refuses an approval for an agent frozen after parking", async () => {
    const { org, agent } = freshOrg();
    const approval = parkedApproval(org.id, agent.agentId, 60_000_000n);
    const before = bal(org.id, `agent:${agent.agentId}:available`);

    store.setAgentStatus(agent.agentId, "frozen");
    const outcome = await resolveApproval(org.id, approval.id, true, "alice");

    assert.equal(outcome.kind, "frozen");
    assert.equal(bal(org.id, `agent:${agent.agentId}:available`), before, "no money moved");
  });

  it("refuses an approval whose destination was blocklisted after parking", async () => {
    const { org, agent } = freshOrg();
    const approval = parkedApproval(org.id, agent.agentId, 60_000_000n);
    const before = bal(org.id, `agent:${agent.agentId}:available`);

    const t = store.getPolicyTemplate(org.id);
    store.setPolicyTemplate(org.id, { ...t, blocklist: [PAYEE] });

    const outcome = await resolveApproval(org.id, approval.id, true, "alice");
    assert.equal(outcome.kind, "resolved");
    assert.equal(outcome.kind === "resolved" && outcome.ok, false);
    assert.equal(bal(org.id, `agent:${agent.agentId}:available`), before, "no money moved");
  });

  it("stops a queue of individually-legal approvals from blowing the daily cap", async () => {
    // The exact scenario the re-check exists for: three parked payments that
    // each pass on their own, but together exceed the daily maximum.
    const { org, agent } = freshOrg();
    const t = store.getPolicyTemplate(org.id);
    store.setPolicyTemplate(org.id, { ...t, dailyMaxMicro: 100_000_000n });

    const a = parkedApproval(org.id, agent.agentId, 60_000_000n);
    const b = parkedApproval(org.id, agent.agentId, 60_000_000n);

    const first = await resolveApproval(org.id, a.id, true, "alice");
    const second = await resolveApproval(org.id, b.id, true, "alice");

    assert.equal(first.kind === "resolved" && first.ok, true, "first should settle");
    assert.equal(second.kind === "resolved" && second.ok, false, "second must be refused");
    assert.equal(
      bal(org.id, `agent:${agent.agentId}:available`),
      140_000_000n,
      "only one payment may have left",
    );
  });

  it("cannot be resolved twice", async () => {
    const { org, agent } = freshOrg();
    const approval = parkedApproval(org.id, agent.agentId, 60_000_000n);

    await resolveApproval(org.id, approval.id, true, "alice");
    const again = await resolveApproval(org.id, approval.id, true, "alice");

    assert.equal(again.kind, "conflict");
    assert.equal(bal(org.id, `agent:${agent.agentId}:available`), 140_000_000n);
  });

  it("counts quorum by authenticated identity, not by the supplied name", async () => {
    const { org, agent } = freshOrg();
    const t = store.getPolicyTemplate(org.id);
    store.setPolicyTemplate(org.id, { ...t, approvalQuorum: 2 });
    const g1 = store.createGuardian(org.id, "Bob", "approver");
    const approval = parkedApproval(org.id, agent.agentId, 60_000_000n);

    // Same guardian voting twice under different display names must not
    // satisfy a 2-of-N quorum on its own.
    const first = await resolveApproval(org.id, approval.id, true, "Bob", g1.id);
    assert.equal(first.kind, "pending_quorum");
    const sameAgain = await resolveApproval(org.id, approval.id, true, "Bob's phone", g1.id);
    assert.equal(sameAgain.kind, "pending_quorum", "one identity cannot reach quorum alone");
    assert.equal(bal(org.id, `agent:${agent.agentId}:available`), 200_000_000n, "nothing moved");

    // A genuinely distinct guardian completes it.
    const g2 = store.createGuardian(org.id, "Carol", "approver");
    const done = await resolveApproval(org.id, approval.id, true, "Carol", g2.id);
    assert.equal(done.kind, "resolved");
    assert.equal(bal(org.id, `agent:${agent.agentId}:available`), 140_000_000n);
  });

  it("lets a view-only guardian deny but never approve", async () => {
    const { org, agent } = freshOrg();
    const viewer = store.createGuardian(org.id, "Dana", "viewer");
    const approval = parkedApproval(org.id, agent.agentId, 60_000_000n);

    const blocked = await resolveApproval(org.id, approval.id, true, "Dana", viewer.id);
    assert.equal(blocked.kind, "forbidden");
    assert.equal(bal(org.id, `agent:${agent.agentId}:available`), 200_000_000n);

    // Denying is always allowed — the asymmetry is deliberate.
    const denied = await resolveApproval(org.id, approval.id, false, "Dana", viewer.id);
    assert.equal(denied.kind, "resolved");
  });

  it("honours a restricted guardian's max-approve cap", async () => {
    const { org, agent } = freshOrg();
    const g = store.createGuardian(org.id, "Eve", "approver");
    store.updateGuardian(org.id, g.id, {
      conditions: { restricted: true, maxApproveUsdc: "10" },
    });
    const approval = parkedApproval(org.id, agent.agentId, 60_000_000n);

    const outcome = await resolveApproval(org.id, approval.id, true, "Eve", g.id);
    assert.equal(outcome.kind, "forbidden");
    assert.equal(bal(org.id, `agent:${agent.agentId}:available`), 200_000_000n);
  });
});

describe("settleEscrow — compare-and-swap before the ledger", () => {
  async function lockedEscrow() {
    const { org, agent } = freshOrg();
    const payee = store.createAgent(org.id, "Worker");
    const result = await executeIntent({
      orgId: org.id,
      agentId: agent.agentId,
      tool: "escrow_lock",
      amountMicro: 20_000_000n,
      amountUsdc: "20",
      destination: payee.agentId,
      payeeAgentId: payee.agentId,
      intentId: id("int"),
    });
    assert.equal(result.ok, true);
    const escrowId = String((result as { payload: Record<string, unknown> }).payload.escrowId);
    return { org, agent, payee, escrow: store.getEscrow(escrowId, org.id)! };
  }

  it("releases to the payee exactly once", async () => {
    const { org, payee, escrow } = await lockedEscrow();

    const first = settleEscrow(escrow, "release", "test");
    assert.equal(first.ok, true);
    assert.equal(bal(org.id, `agent:${payee.agentId}:available`), 20_000_000n);

    // Replaying the stale row must not pay twice.
    const second = settleEscrow(escrow, "release", "test");
    assert.equal(second.ok, false);
    assert.equal(bal(org.id, `agent:${payee.agentId}:available`), 20_000_000n, "paid once only");
  });

  it("refunds to the payer and cannot then be released", async () => {
    const { org, agent, payee, escrow } = await lockedEscrow();

    assert.equal(settleEscrow(escrow, "refund", "test").ok, true);
    assert.equal(bal(org.id, `agent:${agent.agentId}:available`), 200_000_000n);

    const late = settleEscrow(escrow, "release", "test");
    assert.equal(late.ok, false);
    assert.equal(bal(org.id, `agent:${payee.agentId}:available`), 0n);
  });

  it("keeps the books balanced across lock and release", async () => {
    const { org, escrow } = await lockedEscrow();
    settleEscrow(escrow, "release", "test");
    const recon = store.reconcileOrgUncached(org.id);
    assert.equal(recon.ok, true, JSON.stringify(recon.drift));
  });
});

describe("rulesFor — runtime state reaches the policy engine", () => {
  let orgId = "";
  let agentId = "";

  beforeEach(() => {
    const f = freshOrg();
    orgId = f.org.id;
    agentId = f.agent.agentId;
  });

  it("reports a frozen agent and a frozen org", () => {
    assert.equal(rulesFor(agentId, orgId).agentFrozen, false);
    store.setAgentStatus(agentId, "frozen");
    assert.equal(rulesFor(agentId, orgId).agentFrozen, true);

    store.setAgentStatus(agentId, "active");
    store.setOrgStatus(orgId, "frozen");
    assert.equal(rulesFor(agentId, orgId).orgFrozen, true);
  });

  it("treats an archived agent as non-spendable", () => {
    store.setAgentStatus(agentId, "archived");
    assert.equal(rulesFor(agentId, orgId).agentFrozen, true);
  });
});
