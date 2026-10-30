/**
 * Serialise outbound transactions per vault.
 *
 * Audit finding H6: the transfer rail created a fresh viem wallet client per
 * call and let it fetch the nonce. Two agents in the same org paying
 * concurrently — permitted up to `maxPaysPerMinute` — would read the same
 * nonce, and one transaction would silently replace the other. The ledger
 * would record both. For a product whose entire premise is multiple agents
 * spending at once, that is not an edge case.
 *
 * Two layers:
 *   1. A per-vault promise chain orders callers inside one process (cheap, FIFO).
 *   2. A lease in the shared database (`job_locks`, name `lock:<key>`) makes the
 *      lock hold across processes: a second API instance, a scheduler worker,
 *      or a restarted process waits for the holder. The lease has a TTL and is
 *      renewed while the task runs, so a crashed holder cannot wedge a vault;
 *      it simply expires. The store registers the backend at boot
 *      (`registerLeaseBackend`); without one (unit tests of this file) only
 *      layer 1 applies.
 *
 * Waiting longer than ABI_VAULT_LOCK_WAIT_MS (default 90s) throws
 * `VaultLockTimeoutError` BEFORE the task runs, so nothing is signed or sent.
 */
import { randomBytes } from "node:crypto";

/** Shared-database lease: acquire is a compare-and-set, release is by holder. */
export interface LeaseBackend {
  acquire(name: string, holder: string, ttlMs: number): boolean;
  release(name: string, holder: string): void;
}

let leaseBackend: LeaseBackend | undefined;

/** Called by the store at boot so every caller shares the database lease. */
export function registerLeaseBackend(backend: LeaseBackend | undefined): void {
  leaseBackend = backend;
}

export class VaultLockTimeoutError extends Error {
  readonly code = "LOCK_TIMEOUT";
  constructor(key: string, waitedMs: number) {
    super(
      `Another process is still sending from ${key} after ${waitedMs}ms. Nothing was signed or sent; retry with the same idempotency key.`,
    );
    this.name = "VaultLockTimeoutError";
  }
}

const LEASE_TTL_MS = 10 * 60_000;

function lockWaitMs(): number {
  const n = Number(process.env.ABI_VAULT_LOCK_WAIT_MS ?? 90_000);
  return Number.isFinite(n) && n >= 0 ? n : 90_000;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Take the cross-process lease for `key`, or throw before anything runs. */
async function acquireLease(key: string): Promise<(() => void) | undefined> {
  const backend = leaseBackend;
  if (!backend) return undefined;
  const name = `lock:${key}`;
  const holder = `${process.pid}:${randomBytes(6).toString("hex")}`;
  const started = Date.now();
  const limit = lockWaitMs();
  let delay = 20;
  while (!backend.acquire(name, holder, LEASE_TTL_MS)) {
    const waited = Date.now() - started;
    if (waited >= limit) throw new VaultLockTimeoutError(key, waited);
    await sleep(Math.min(delay, Math.max(1, limit - waited)));
    delay = Math.min(delay * 2, 250);
  }
  // Renew while the task runs so a long receipt wait never loses the lease.
  const renew = setInterval(() => {
    try {
      backend.acquire(name, holder, LEASE_TTL_MS);
    } catch {
      /* the next renewal or the TTL handles it */
    }
  }, LEASE_TTL_MS / 3);
  (renew as { unref?: () => void }).unref?.();
  return () => {
    clearInterval(renew);
    try {
      backend.release(name, holder);
    } catch {
      /* expires on its own */
    }
  };
}

/** Tail of the in-flight chain per vault address. */
const chains = new Map<string, Promise<unknown>>();

/** Observability: how many callers are waiting on each vault right now. */
const waiting = new Map<string, number>();

export function queueDepth(vaultAddress: string): number {
  return waiting.get(vaultAddress.toLowerCase()) ?? 0;
}

/**
 * Run `task` after every previously-queued task for this vault has settled.
 *
 * Failures do not poison the chain — the next caller still runs — because one
 * reverted transfer must not wedge an organization's payments.
 */
export async function withVaultLock<T>(vaultAddress: string, task: () => Promise<T>): Promise<T> {
  const key = vaultAddress.toLowerCase();
  waiting.set(key, (waiting.get(key) ?? 0) + 1);

  const previous = chains.get(key) ?? Promise.resolve();
  // Swallow the predecessor's rejection: we care that it *finished*, not how.
  const run = previous
    .catch(() => undefined)
    .then(async () => {
      const release = await acquireLease(key);
      try {
        return await task();
      } finally {
        release?.();
      }
    });

  // Keep the chain alive regardless of this task's outcome.
  chains.set(
    key,
    run.catch(() => undefined),
  );

  try {
    return await run;
  } finally {
    const left = (waiting.get(key) ?? 1) - 1;
    if (left <= 0) {
      waiting.delete(key);
      // Only drop the chain when nobody else is queued behind us, so a later
      // caller cannot start before an in-flight predecessor completes.
      if (chains.get(key) === undefined) chains.delete(key);
    } else {
      waiting.set(key, left);
    }
  }
}

/** Test-only: forget all chains between cases. */
export function resetVaultQueuesForTests(): void {
  chains.clear();
  waiting.clear();
}
