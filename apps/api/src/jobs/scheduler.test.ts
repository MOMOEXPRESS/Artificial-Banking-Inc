/**
 * Job leases exist so scaling past one instance cannot double-run a
 * money-affecting sweep. A subscription charge that runs twice is a
 * double-spend, so "at most one holder" is a correctness property, not an
 * optimisation.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "pv-jobs-"));
process.env.POLICYVAULT_DB = join(dir, "jobs.db");
process.env.ABI_KEY_PEPPER = "test-pepper";
process.env.ABI_NO_LISTEN = "1";

const { store } = await import("../store.js");
const { runJobOnce, startScheduler } = await import("./scheduler.js");

after(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("job leases", () => {
  it("grants the lease to exactly one holder", () => {
    assert.equal(store.acquireJobLock("solo", "instance-a", 60_000), true);
    assert.equal(store.acquireJobLock("solo", "instance-b", 60_000), false);
  });

  it("lets the same holder renew its own lease", () => {
    assert.equal(store.acquireJobLock("renew", "instance-a", 60_000), true);
    assert.equal(store.acquireJobLock("renew", "instance-a", 60_000), true);
  });

  it("hands the lease over once it expires, so a crashed holder cannot wedge a job", async () => {
    assert.equal(store.acquireJobLock("expiring", "dead-instance", 1), true);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(store.acquireJobLock("expiring", "live-instance", 60_000), true);
  });

  it("frees the lease on release", () => {
    assert.equal(store.acquireJobLock("released", "instance-a", 60_000), true);
    store.releaseJobLock("released", "instance-a");
    assert.equal(store.acquireJobLock("released", "instance-b", 60_000), true);
  });

  it("ignores a release from a holder that does not own the lease", () => {
    assert.equal(store.acquireJobLock("guarded", "owner", 60_000), true);
    store.releaseJobLock("guarded", "impostor");
    assert.equal(store.acquireJobLock("guarded", "someone-else", 60_000), false);
  });
});

describe("runJobOnce", () => {
  it("runs the job and releases the lease afterwards", async () => {
    let runs = 0;
    const job = {
      name: "counting",
      intervalMs: 1000,
      leaseMs: 60_000,
      run: () => {
        runs += 1;
      },
    };

    assert.equal(await runJobOnce(job, "holder-1"), true);
    assert.equal(runs, 1);
    // Lease released, so a different holder may take it immediately.
    assert.equal(await runJobOnce(job, "holder-2"), true);
    assert.equal(runs, 2);
  });

  it("skips when another holder currently owns the lease", async () => {
    let runs = 0;
    const job = {
      name: "contended",
      intervalMs: 1000,
      leaseMs: 60_000,
      run: () => {
        runs += 1;
      },
    };

    store.acquireJobLock("contended", "other-instance", 60_000);
    assert.equal(await runJobOnce(job, "me"), false);
    assert.equal(runs, 0, "must not run while another instance holds the lease");
  });

  it("releases the lease even when the job throws", async () => {
    const job = {
      name: "explodes",
      intervalMs: 1000,
      leaseMs: 60_000,
      run: () => {
        throw new Error("boom");
      },
    };

    // A failure must not wedge the job until its lease expires.
    assert.equal(await runJobOnce(job, "holder-1"), true);
    assert.equal(store.acquireJobLock("explodes", "holder-2", 60_000), true);
  });

  it("isolates failures — one bad job does not stop the others", async () => {
    let goodRuns = 0;
    const bad = {
      name: "bad",
      intervalMs: 1000,
      leaseMs: 60_000,
      run: () => {
        throw new Error("nope");
      },
    };
    const good = {
      name: "good",
      intervalMs: 1000,
      leaseMs: 60_000,
      run: () => {
        goodRuns += 1;
      },
    };

    await runJobOnce(bad, "h");
    await runJobOnce(good, "h");
    assert.equal(goodRuns, 1);
  });
});

describe("startScheduler", () => {
  it("starts and stops without holding the process open", () => {
    const handle = startScheduler([
      { name: "noop", intervalMs: 60_000, leaseMs: 60_000, run: () => {} },
    ]);
    assert.equal(typeof handle.stop, "function");
    handle.stop();
  });
});
