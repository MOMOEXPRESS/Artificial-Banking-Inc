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
 * A per-vault promise chain is the smallest correct fix while ABI still signs
 * locally. It holds only within one process; the moment the API runs more than
 * one instance this must move to a database-backed queue, or to a custody
 * provider that sequences for us (roadmap P4-T1). That constraint is asserted
 * below rather than left implicit.
 */

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
  const run = previous.catch(() => undefined).then(task);

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
