/**
 * Per-vault transaction serialisation (audit finding H6).
 *
 * The transfer rail created a fresh wallet client per call and let it fetch the
 * nonce. Two agents in the same org paying concurrently would read the same
 * nonce and one transaction would silently replace the other — while the ledger
 * recorded both. Multi-agent concurrency is the product's whole premise, so
 * this is the common path, not an edge case.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { queueDepth, resetVaultQueuesForTests, withVaultLock } from "./vault-queue.js";

afterEach(() => resetVaultQueuesForTests());

const VAULT_A = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const VAULT_B = "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

describe("withVaultLock", () => {
  it("never runs two transfers for the same vault at once", async () => {
    let active = 0;
    let maxActive = 0;

    await Promise.all(
      Array.from({ length: 8 }, () =>
        withVaultLock(VAULT_A, async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await tick();
          active -= 1;
        }),
      ),
    );

    assert.equal(maxActive, 1, "overlapping sends would collide on the nonce");
  });

  it("preserves submission order", async () => {
    const order: number[] = [];
    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        withVaultLock(VAULT_A, async () => {
          await tick(5 - i); // later tasks are faster, so only the lock can order them
          order.push(i);
        }),
      ),
    );
    assert.deepEqual(order, [0, 1, 2, 3, 4]);
  });

  it("does not serialise across different vaults", async () => {
    // One org's payments must not be held up by another's.
    let active = 0;
    let maxActive = 0;
    const body = async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await tick(15);
      active -= 1;
    };

    await Promise.all([withVaultLock(VAULT_A, body), withVaultLock(VAULT_B, body)]);
    assert.equal(maxActive, 2, "separate vaults should run in parallel");
  });

  it("returns each task's own value", async () => {
    const results = await Promise.all([
      withVaultLock(VAULT_A, async () => "first"),
      withVaultLock(VAULT_A, async () => "second"),
    ]);
    assert.deepEqual(results, ["first", "second"]);
  });

  it("propagates a failure to its own caller only", async () => {
    const failing = withVaultLock(VAULT_A, async () => {
      throw new Error("reverted");
    });
    const following = withVaultLock(VAULT_A, async () => "still ran");

    await assert.rejects(failing, /reverted/);
    assert.equal(await following, "still ran");
  });

  it("does not wedge the vault after a failure", async () => {
    // A single reverted transfer must not stop an organization from paying.
    await withVaultLock(VAULT_A, async () => {
      throw new Error("boom");
    }).catch(() => undefined);

    assert.equal(await withVaultLock(VAULT_A, async () => "recovered"), "recovered");
  });

  it("still serialises when an earlier task rejects mid-queue", async () => {
    let active = 0;
    let maxActive = 0;
    const results = await Promise.allSettled([
      withVaultLock(VAULT_A, async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await tick();
        active -= 1;
        throw new Error("first fails");
      }),
      withVaultLock(VAULT_A, async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await tick();
        active -= 1;
        return "second ok";
      }),
    ]);

    assert.equal(maxActive, 1);
    assert.equal(results[0]!.status, "rejected");
    assert.equal(results[1]!.status, "fulfilled");
  });

  it("reports queue depth and drains to empty", async () => {
    const started: Promise<unknown>[] = [];
    for (let i = 0; i < 3; i++) started.push(withVaultLock(VAULT_A, () => tick(10)));
    assert.ok(queueDepth(VAULT_A) > 0, "callers should be visible while waiting");
    await Promise.all(started);
    assert.equal(queueDepth(VAULT_A), 0, "queue must drain");
  });
});
