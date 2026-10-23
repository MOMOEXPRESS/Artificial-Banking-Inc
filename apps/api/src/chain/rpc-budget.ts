/**
 * Per-invocation RPC budget.
 *
 * Cloudflare Workers caps outbound subrequests per invocation (50 on the free
 * plan), and one Durable Object alarm tick runs every background job: deposit
 * sweep, gas monitor, on-chain backing, settlement recovery, webhook retries.
 * Each job used to read the chain for every org on its own, so together they
 * blew the cap and the later jobs failed every tick ("unreadable" vaults).
 *
 * `runWithRpcBudget` gives a tick a shared allowance; chain readers call
 * `tryTakeRpc` before each call and back off when it is spent. Outside a
 * budgeted scope (request handlers, tests) reads are unlimited.
 */
import { AsyncLocalStorage } from "node:async_hooks";

type Budget = { remaining: number };

const als = new AsyncLocalStorage<Budget>();

/** Marker in error strings so callers can tell "budget spent" from "chain down". */
export const RPC_BUDGET_EXHAUSTED = "RPC budget for this tick is spent";

export function runWithRpcBudget<T>(calls: number, fn: () => Promise<T>): Promise<T> {
  return als.run({ remaining: Math.max(0, Math.floor(calls)) }, fn);
}

/** Calls left in the current budget, or null when unbudgeted. */
export function rpcRemaining(): number | null {
  return als.getStore()?.remaining ?? null;
}

/** Reserve `n` calls. Always true outside a budgeted scope. */
export function tryTakeRpc(n = 1): boolean {
  const b = als.getStore();
  if (!b) return true;
  if (b.remaining < n) return false;
  b.remaining -= n;
  return true;
}

export function isRpcBudgetError(message: string | undefined): boolean {
  return Boolean(message && message.includes(RPC_BUDGET_EXHAUSTED));
}
