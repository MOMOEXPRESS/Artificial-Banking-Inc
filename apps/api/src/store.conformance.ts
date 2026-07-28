/**
 * The store contract, as executable tests (roadmap P2-T2, stage 1).
 *
 * `store.ts` is ~4,700 lines behind a single boundary, and the Postgres
 * migration means writing a second implementation of it. The dangerous version
 * of that work is: rewrite everything, run the existing tests, ship. Those
 * tests exercise the *engine*, so they would pass against a store that quietly
 * broke isolation levels, CAS semantics, or transaction atomicity — the exact
 * properties SQLite gives for free and Postgres gives only if you ask.
 *
 * So this file is the contract, written once and run against every
 * implementation. It deliberately tests behaviour a second backend could get
 * wrong, not behaviour that is obviously portable:
 *
 *   - journal application is atomic and balance-preserving
 *   - a ledger violation rolls back completely, leaving no partial write
 *   - compare-and-swap really swaps once (escrow, approval, subscription)
 *   - idempotency reservation is a race winner, not a check-then-write
 *   - tenant scoping holds at the reader
 *   - money arithmetic survives values that overflow a float
 *
 * Adding a backend means calling `runStoreConformance` with it. If a test here
 * fails, the backend is not a drop-in — which is precisely what you want to
 * learn before it holds anyone's money.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { JournalEntry } from "@policyvault/ledger";
import type { scopedStore as ScopedStoreFn, store as SqliteStore } from "./store.js";

/**
 * The surface a backend must implement. Structural, not nominal: today it is
 * satisfied by the SQLite store, and a Postgres one has to match it exactly
 * rather than approximately.
 */
export type StoreUnderTest = {
  store: typeof SqliteStore;
  scopedStore: typeof ScopedStoreFn;
};

const j = (over: Partial<JournalEntry> & { orgId: string; lines: JournalEntry["lines"] }): JournalEntry => ({
  id: `j_${Math.random().toString(16).slice(2, 10)}`,
  memo: "conformance",
  createdAt: new Date().toISOString(),
  ...over,
});

export function runStoreConformance(backendName: string, backend: StoreUnderTest): void {
  const { store, scopedStore } = backend;

  const org = (name: string, deposit = 1_000_000_000n) => store.createOrg(name, deposit);

  describe(`${backendName} — journals are atomic`, () => {
    it("applies a balanced entry and moves exactly what it says", () => {
      const o = org("Atomic Co");
      const before = store.getAccountMap(o.id).get(`org:${o.id}:available`)?.balanceMicro ?? 0n;

      store.applyEntries(o.id, [
        j({
          orgId: o.id,
          lines: [
            { accountId: `org:${o.id}:available`, deltaMicro: -25_000_000n },
            { accountId: `org:${o.id}:external`, deltaMicro: 25_000_000n },
          ],
        }),
      ]);

      const after = store.getAccountMap(o.id).get(`org:${o.id}:available`)?.balanceMicro ?? 0n;
      assert.equal(before - after, 25_000_000n);
    });

    it("rolls back the whole batch when one entry violates the ledger", () => {
      // The property that matters: no partial application. A backend with
      // autocommit-per-statement passes the happy path and fails this.
      const o = org("Rollback Co");
      const start = store.getAccountMap(o.id).get(`org:${o.id}:available`)?.balanceMicro ?? 0n;

      assert.throws(() =>
        store.applyEntries(o.id, [
          j({
            orgId: o.id,
            lines: [
              { accountId: `org:${o.id}:available`, deltaMicro: -1_000_000n },
              { accountId: `org:${o.id}:external`, deltaMicro: 1_000_000n },
            ],
          }),
          // Unbalanced: debits and credits do not sum to zero.
          j({
            orgId: o.id,
            lines: [{ accountId: `org:${o.id}:available`, deltaMicro: -5_000_000n }],
          }),
        ]),
      );

      const end = store.getAccountMap(o.id).get(`org:${o.id}:available`)?.balanceMicro ?? 0n;
      assert.equal(end, start, "the first entry must not survive the second's failure");
    });

    it("keeps the books summing to zero across every account", () => {
      const o = org("Balanced Co");
      store.applyEntries(o.id, [
        j({
          orgId: o.id,
          lines: [
            { accountId: `org:${o.id}:available`, deltaMicro: -7_000_000n },
            { accountId: `org:${o.id}:revenue`, deltaMicro: 7_000_000n },
          ],
        }),
      ]);
      const total = [...store.getAccountMap(o.id).values()].reduce(
        (acc, a) => acc + a.balanceMicro,
        0n,
      );
      // Opening balance is seeded onto org:available without a contra entry,
      // so the invariant is "unchanged by journals", not "zero".
      assert.equal(total, 1_000_000_000n);
    });
  });

  describe(`${backendName} — compare-and-swap`, () => {
    it("lets exactly one caller claim an escrow", () => {
      const o = org("Escrow CAS Co");
      const payer = store.createAgent(o.id, "Payer");
      const payee = store.createAgent(o.id, "Payee");
      const escrowId = `esc_conf_${Math.random().toString(16).slice(2, 8)}`;
      store.createEscrow({
        id: escrowId,
        orgId: o.id,
        payerAgentId: payer.agentId,
        payeeAgentId: payee.agentId,
        amountMicro: 5_000_000n,
        state: "locked",
        createdAt: new Date().toISOString(),
        timeoutAt: new Date(Date.now() + 60_000).toISOString(),
      });

      assert.equal(store.claimEscrow(escrowId), true, "first claim wins");
      assert.equal(store.claimEscrow(escrowId), false, "second claim must lose");
      store.unclaimEscrow(escrowId);
      assert.equal(store.claimEscrow(escrowId), true, "unclaim restores the race");
    });

    it("lets exactly one caller claim an approval", () => {
      const o = org("Approval CAS Co");
      const agent = store.createAgent(o.id, "Spender");
      const approvalId = `apr_conf_${Math.random().toString(16).slice(2, 8)}`;
      store.createApproval({
        id: approvalId,
        intentId: `int_${approvalId}`,
        orgId: o.id,
        agentId: agent.agentId,
        tool: "pay",
        amountMicro: 1_000_000n,
        amountUsdc: "1.00",
        destination: "0x1111111111111111111111111111111111111111",
        idempotencyKey: `idem_${approvalId}`,
        reasons: ["hitl_above"],
        ruleIds: ["hitl_above"],
        status: "pending",
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      });

      assert.equal(store.claimApproval(approvalId), true);
      assert.equal(store.claimApproval(approvalId), false, "double-approve must be impossible");
    });

    it("reserves an idempotency key exactly once", () => {
      // Must be a write that fails on conflict, not a read followed by a write:
      // the x402 rail awaits network I/O inside that window.
      const o = org("Idem Co");
      assert.equal(store.reserveIdempotent(o.id, "key-1"), true);
      assert.equal(store.reserveIdempotent(o.id, "key-1"), false);

      store.releaseIdempotent(o.id, "key-1");
      assert.equal(store.reserveIdempotent(o.id, "key-1"), true, "a released key is retryable");
    });

    it("scopes idempotency keys per organization", () => {
      const a = org("Idem A");
      const b = org("Idem B");
      assert.equal(store.reserveIdempotent(a.id, "shared-key"), true);
      assert.equal(
        store.reserveIdempotent(b.id, "shared-key"),
        true,
        "one org's key must not block another's",
      );
    });
  });

  describe(`${backendName} — settlement state machine`, () => {
    it("records an intent before the rail runs and survives to completion", () => {
      const o = org("Settle Co");
      const agent = store.createAgent(o.id, "Spender");
      const intentId = `int_conf_${Math.random().toString(16).slice(2, 8)}`;

      store.beginSettlement({
        intentId,
        orgId: o.id,
        agentId: agent.agentId,
        tool: "pay",
        amountMicro: 3_000_000n,
        destination: "0x2222222222222222222222222222222222222222",
      });
      assert.equal(store.getSettlement(intentId)?.state, "pending");

      store.markSettlementBroadcast(intentId, "evm-usdc-transfer", "0xdeadbeef");
      const broadcast = store.getSettlement(intentId);
      assert.equal(broadcast?.state, "broadcast");
      assert.equal(broadcast?.txHash, "0xdeadbeef");

      store.finishSettlement(intentId, {
        state: "settled",
        rail: "evm-usdc-transfer",
        chargedMicro: 3_000_000n,
      });
      assert.equal(store.getSettlement(intentId)?.state, "settled");
    });
  });

  describe(`${backendName} — tenant isolation`, () => {
    it("never returns another organization's rows", () => {
      const a = org("Iso A");
      const b = org("Iso B");
      const aAgent = store.createAgent(a.id, "A Agent");

      assert.ok(scopedStore(a.id).getAgent(aAgent.agentId));
      assert.equal(scopedStore(b.id).getAgent(aAgent.agentId), undefined);
    });
  });

  describe(`${backendName} — money arithmetic`, () => {
    it("survives amounts that lose precision as floats", () => {
      // 2^53 + 1 micro-USDC. A backend that round-trips through a double
      // silently corrupts this, and the corruption is invisible until an
      // audit. Postgres NUMERIC and JS bigint must agree exactly.
      const o = org("Big Number Co", 0n);
      const huge = 9_007_199_254_740_993n;

      store.applyEntries(o.id, [
        j({
          orgId: o.id,
          lines: [
            { accountId: `org:${o.id}:external`, deltaMicro: -huge },
            { accountId: `org:${o.id}:available`, deltaMicro: huge },
          ],
        }),
      ]);

      assert.equal(store.getAccountMap(o.id).get(`org:${o.id}:available`)?.balanceMicro, huge);
    });

    it("keeps negative balances exact on the contra account", () => {
      const o = org("Contra Co", 0n);
      store.applyEntries(o.id, [
        j({
          orgId: o.id,
          lines: [
            { accountId: `org:${o.id}:external`, deltaMicro: -1n },
            { accountId: `org:${o.id}:available`, deltaMicro: 1n },
          ],
        }),
      ]);
      assert.equal(store.getAccountMap(o.id).get(`org:${o.id}:external`)?.balanceMicro, -1n);
    });
  });

  describe(`${backendName} — reconciliation`, () => {
    it("replays journals back to the recorded balances", () => {
      const o = org("Recon Co");
      store.applyEntries(o.id, [
        j({
          orgId: o.id,
          lines: [
            { accountId: `org:${o.id}:available`, deltaMicro: -4_000_000n },
            { accountId: `org:${o.id}:external`, deltaMicro: 4_000_000n },
          ],
        }),
      ]);
      const result = store.reconcileOrg(o.id);
      assert.equal(result.ok, true, JSON.stringify(result.drift));
      assert.ok(result.journalsReplayed > 0);
    });
  });
}
