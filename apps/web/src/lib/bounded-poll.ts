/**
 * Bounded polling for console panels.
 *
 * Insights used to re-request all four analytics endpoints on a fixed 20 s
 * interval forever. A part that failed was simply asked again on the next tick
 * (and the next…), and the banner said "It keeps retrying in the background"
 * with no end. This keeps the steady refresh for parts that work, retries a
 * failing part with exponential backoff, and stops after a fixed number of
 * attempts so the panel can say plainly that it gave up and offer Retry.
 */
import type { LoadFailure } from "./load-state";

export type BackoffOptions = {
  /** First retry delay. */
  baseMs: number;
  /** Ceiling for any single retry delay. */
  maxMs: number;
  /** Automatic retries after the first failure before giving up. */
  maxRetries: number;
};

export const DEFAULT_BACKOFF: BackoffOptions = { baseMs: 2_000, maxMs: 30_000, maxRetries: 4 };

/** Delay before retry number `attempt` (1-based): 2 s, 4 s, 8 s, 16 s … capped. */
export function backoffDelay(attempt: number, opts: Pick<BackoffOptions, "baseMs" | "maxMs">) {
  const n = Math.max(1, Math.floor(attempt));
  return Math.min(opts.maxMs, opts.baseMs * 2 ** (n - 1));
}

/**
 * How long the console shell's 8 s heartbeat waits after `failures`
 * consecutive failed refreshes: 16 s, 32 s, then 60 s. It never stops — the
 * heartbeat is also how an ended session is noticed — it only slows down.
 */
export function fastPollBackoffMs(failures: number): number {
  if (failures <= 0) return 0;
  return backoffDelay(failures, { baseMs: 16_000, maxMs: 60_000 });
}

export type PollStatus = "idle" | "ok" | "retrying" | "failed";

export type PollState = {
  status: PollStatus;
  /** Consecutive failures since the last success (0 when healthy). */
  failures: number;
  lastOkAt: number | null;
  lastFailure: LoadFailure | null;
  /** When the next automatic attempt is due, or null when none is scheduled. */
  nextAt: number | null;
};

export type PollResult = { ok: true } | { ok: false; failure: LoadFailure };

type Timer = unknown;

export type BoundedPollerOptions = {
  run: () => Promise<PollResult>;
  intervalMs: number;
  backoff?: Partial<BackoffOptions>;
  onChange?: (s: PollState) => void;
  isHidden?: () => boolean;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => Timer;
  clearTimer?: (t: Timer) => void;
};

export type BoundedPoller = {
  start: () => void;
  stop: () => void;
  /** Manual Retry: resets the attempt budget and runs now. */
  retryNow: () => Promise<void>;
  /** Tab became visible again: run now if a tick was skipped while hidden. */
  resume: () => void;
  getState: () => PollState;
};

export function createBoundedPoller(opts: BoundedPollerOptions): BoundedPoller {
  const backoff = { ...DEFAULT_BACKOFF, ...(opts.backoff ?? {}) };
  const now = opts.now ?? (() => Date.now());
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer =
    opts.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  const isHidden = opts.isHidden ?? (() => false);

  let state: PollState = {
    status: "idle",
    failures: 0,
    lastOkAt: null,
    lastFailure: null,
    nextAt: null,
  };
  let timer: Timer | null = null;
  let running = false;
  let inFlight: Promise<void> | null = null;
  let skippedWhileHidden = false;

  const emit = (patch: Partial<PollState>) => {
    state = { ...state, ...patch };
    opts.onChange?.(state);
  };

  const clear = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };

  const schedule = (ms: number) => {
    clear();
    if (!running) return;
    emit({ nextAt: now() + ms });
    timer = setTimer(() => {
      timer = null;
      void tick();
    }, ms);
  };

  const tick = (): Promise<void> => {
    if (!running) return Promise.resolve();
    if (inFlight) return inFlight;
    if (isHidden()) {
      // Don't spend requests (or the retry budget) on a hidden tab.
      skippedWhileHidden = true;
      emit({ nextAt: null });
      return Promise.resolve();
    }
    skippedWhileHidden = false;
    inFlight = (async () => {
      let result: PollResult;
      try {
        result = await opts.run();
      } catch (e) {
        result = {
          ok: false,
          failure: {
            path: "",
            status: 0,
            reason: e instanceof Error ? e.message || "error" : "error",
            at: now(),
          },
        };
      }
      if (!running) return;
      if (result.ok) {
        emit({ status: "ok", failures: 0, lastOkAt: now(), lastFailure: null });
        schedule(opts.intervalMs);
        return;
      }
      const failures = state.failures + 1;
      if (failures > backoff.maxRetries) {
        // Out of automatic attempts: stop and wait for a manual Retry.
        clear();
        emit({ status: "failed", failures, lastFailure: result.failure, nextAt: null });
        return;
      }
      emit({ status: "retrying", failures, lastFailure: result.failure });
      schedule(backoffDelay(failures, backoff));
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };

  return {
    start() {
      if (running) return;
      running = true;
      void tick();
    },
    stop() {
      running = false;
      clear();
    },
    async retryNow() {
      if (!running) running = true;
      if (inFlight) await inFlight;
      clear();
      emit({ failures: 0, status: state.status === "failed" ? "retrying" : state.status });
      await tick();
    },
    resume() {
      if (!running || !skippedWhileHidden || state.status === "failed") return;
      clear();
      void tick();
    },
    getState: () => state,
  };
}
