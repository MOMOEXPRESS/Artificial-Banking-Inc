import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  backoffDelay,
  createBoundedPoller,
  fastPollBackoffMs,
  type PollResult,
} from "./bounded-poll";

/** Manual clock + timer queue so the tests never sleep. */
function fakeTimers() {
  let t = 0;
  let seq = 0;
  const q = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => t,
    setTimer: (fn: () => void, ms: number) => {
      const id = ++seq;
      q.set(id, { at: t + ms, fn });
      return id;
    },
    clearTimer: (id: unknown) => void q.delete(id as number),
    pending: () => [...q.values()].map((x) => x.at - t).sort((a, b) => a - b),
    /** Advance to the next timer and fire it; resolves after its async work. */
    async next() {
      const [id, item] = [...q.entries()].sort((a, b) => a[1].at - b[1].at)[0] ?? [];
      if (!item) return false;
      q.delete(id as number);
      t = item.at;
      item.fn();
      await flush();
      return true;
    },
  };
}
const flush = () => new Promise((r) => setImmediate(r));
const fail = (reason = "HTTP 500"): PollResult => ({
  ok: false,
  failure: { path: "/v1/guardian/burn", status: 500, reason, at: 0 },
});

describe("backoffDelay", () => {
  it("doubles from the base and caps", () => {
    const o = { baseMs: 2000, maxMs: 30_000 };
    assert.deepEqual([1, 2, 3, 4, 5, 6].map((a) => backoffDelay(a, o)), [
      2000, 4000, 8000, 16_000, 30_000, 30_000,
    ]);
  });
});

describe("fastPollBackoffMs", () => {
  it("slows the shell heartbeat after failures but never stops it", () => {
    assert.deepEqual([0, 1, 2, 3, 9].map(fastPollBackoffMs), [0, 16_000, 32_000, 60_000, 60_000]);
  });
});

describe("createBoundedPoller", () => {
  it("polls on the steady interval while the endpoint answers", async () => {
    const ft = fakeTimers();
    let calls = 0;
    const p = createBoundedPoller({
      run: async () => (calls++, { ok: true }),
      intervalMs: 20_000,
      ...ft,
    });
    p.start();
    await flush();
    assert.equal(calls, 1);
    assert.deepEqual(ft.pending(), [20_000]);
    await ft.next();
    assert.equal(calls, 2);
    assert.equal(p.getState().status, "ok");
  });

  it("retries with backoff, then stops after maxRetries and waits for a manual retry", async () => {
    const ft = fakeTimers();
    let calls = 0;
    const p = createBoundedPoller({
      run: async () => (calls++, fail()),
      intervalMs: 20_000,
      backoff: { baseMs: 2000, maxMs: 30_000, maxRetries: 3 },
      ...ft,
    });
    p.start();
    await flush();
    const delays: number[] = [];
    while (ft.pending().length) {
      delays.push(ft.pending()[0]);
      await ft.next();
    }
    // 1 initial attempt + 3 retries, spaced 2s/4s/8s, then nothing scheduled.
    assert.equal(calls, 4);
    assert.deepEqual(delays, [2000, 4000, 8000]);
    assert.equal(p.getState().status, "failed");
    assert.equal(p.getState().nextAt, null);
    assert.equal(p.getState().lastFailure?.reason, "HTTP 500");

    // No background loop after giving up.
    assert.equal(await ft.next(), false);
    assert.equal(calls, 4);

    // Manual retry runs immediately with a fresh budget.
    await p.retryNow();
    assert.equal(calls, 5);
    assert.equal(p.getState().status, "retrying");
    assert.deepEqual(ft.pending(), [2000]);
  });

  it("recovers to the steady interval after a success", async () => {
    const ft = fakeTimers();
    const answers: PollResult[] = [fail(), fail(), { ok: true }];
    const p = createBoundedPoller({
      run: async () => answers.shift() ?? { ok: true },
      intervalMs: 20_000,
      ...ft,
    });
    p.start();
    await flush();
    await ft.next();
    await ft.next();
    assert.equal(p.getState().status, "ok");
    assert.equal(p.getState().failures, 0);
    assert.deepEqual(ft.pending(), [20_000]);
  });

  it("does not spend attempts while the tab is hidden, and resumes when visible", async () => {
    const ft = fakeTimers();
    let hidden = true;
    let calls = 0;
    const p = createBoundedPoller({
      run: async () => (calls++, { ok: true }),
      intervalMs: 20_000,
      isHidden: () => hidden,
      ...ft,
    });
    p.start();
    await flush();
    assert.equal(calls, 0);
    assert.deepEqual(ft.pending(), []);
    hidden = false;
    p.resume();
    await flush();
    assert.equal(calls, 1);
  });

  it("treats a thrown run as a failure instead of breaking the loop", async () => {
    const ft = fakeTimers();
    const p = createBoundedPoller({
      run: async () => {
        throw new Error("boom");
      },
      intervalMs: 20_000,
      ...ft,
    });
    p.start();
    await flush();
    assert.equal(p.getState().status, "retrying");
    assert.equal(p.getState().lastFailure?.reason, "boom");
  });

  it("stop() cancels any scheduled attempt", async () => {
    const ft = fakeTimers();
    const p = createBoundedPoller({ run: async () => fail(), intervalMs: 20_000, ...ft });
    p.start();
    await flush();
    assert.equal(ft.pending().length, 1);
    p.stop();
    assert.equal(ft.pending().length, 0);
  });
});
