/**
 * L4 and NEW-4 — two fail-open defaults on the money path.
 *
 * L4: `escrow_lock` records a payment when funds are committed, which is
 * correct. A refund left that record in place, so a locked-then-refunded
 * escrow permanently consumed daily-cap headroom for money the agent got back.
 *
 * NEW-4: minting a session key without naming its scopes granted read + pay +
 * escrow — full spend authority from a forgotten field.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "pv-capreversal-"));
process.env.POLICYVAULT_DB = join(dir, "cap.db");

const { store } = await import("./store.js");

after(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("daily-cap reversal for uncompleted commitments (L4)", () => {
  it("gives back the headroom an escrow took, once it is refunded", () => {
    const org = store.createOrg("Escrow Cap Co", 1_000_000_000n);
    const agent = store.createAgent(org.id, "Payer");

    store.recordPay(agent.agentId, 40_000_000n, org.id, { ref: "escrow:esc_1" });
    assert.equal(store.spentLast24h(agent.agentId), 40_000_000n, "lock consumes cap");

    const reversed = store.reversePayByRef("escrow:esc_1");
    assert.equal(reversed.removed, 1);
    assert.equal(reversed.amountMicro, 40_000_000n);
    assert.equal(store.spentLast24h(agent.agentId), 0n, "refund returns the headroom");
  });

  it("reverses only the named escrow, not another of the same size", () => {
    // The reason reversal keys on a ref instead of matching by amount: two
    // escrows for the same value are ordinary, and refunding one must not
    // credit back the other.
    const org = store.createOrg("Two Escrows Co", 1_000_000_000n);
    const agent = store.createAgent(org.id, "Payer");

    store.recordPay(agent.agentId, 25_000_000n, org.id, { ref: "escrow:esc_a" });
    store.recordPay(agent.agentId, 25_000_000n, org.id, { ref: "escrow:esc_b" });
    assert.equal(store.spentLast24h(agent.agentId), 50_000_000n);

    store.reversePayByRef("escrow:esc_a");
    assert.equal(store.spentLast24h(agent.agentId), 25_000_000n, "the other escrow still counts");
  });

  it("leaves ordinary payments alone — they have no ref to reverse", () => {
    const org = store.createOrg("Plain Pay Co", 1_000_000_000n);
    const agent = store.createAgent(org.id, "Payer");

    store.recordPay(agent.agentId, 10_000_000n, org.id, { destination: "api.example.com" });
    assert.equal(store.reversePayByRef("escrow:nope").removed, 0);
    assert.equal(store.spentLast24h(agent.agentId), 10_000_000n, "a real payment stays spent");
  });

  it("is idempotent, because a refund path may be retried", () => {
    const org = store.createOrg("Retry Co", 1_000_000_000n);
    const agent = store.createAgent(org.id, "Payer");

    store.recordPay(agent.agentId, 15_000_000n, org.id, { ref: "escrow:esc_r" });
    assert.equal(store.reversePayByRef("escrow:esc_r").removed, 1);
    assert.equal(store.reversePayByRef("escrow:esc_r").removed, 0, "second call is a no-op");
    assert.equal(store.spentLast24h(agent.agentId), 0n);
  });
});

describe("session key scopes default to least privilege (NEW-4)", () => {
  it("grants read only when scopes are omitted", () => {
    const org = store.createOrg("Scope Default Co", 0n);
    const agent = store.createAgent(org.id, "Runner");

    const key = store.createSessionKey({ orgId: org.id, agentId: agent.agentId });
    assert.deepEqual(key.scopes, ["read"]);
    assert.equal(key.scopes.includes("pay"), false, "a forgotten field must not grant spend");
  });

  it("still honours scopes that are asked for explicitly", () => {
    const org = store.createOrg("Scope Explicit Co", 0n);
    const agent = store.createAgent(org.id, "Runner");

    const key = store.createSessionKey({
      orgId: org.id,
      agentId: agent.agentId,
      scopes: ["read", "pay"],
    });
    assert.deepEqual(key.scopes, ["read", "pay"]);
  });
});
