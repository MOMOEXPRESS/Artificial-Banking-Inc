/**
 * Background job scheduler.
 *
 * Replaces three bare `setInterval` blocks that lived inside the API module and
 * were gated behind `if (!embedded)`. On the serverless deployment that gate
 * was always true, so in production: subscriptions never charged, the
 * reconciliation watchdog never ran, Telegram polling never started, and escrow
 * and approval expiry only fired when a human happened to open the relevant
 * screen.
 *
 * Every job here:
 *   - takes a time-boxed lease, so scaling past one instance cannot double-run
 *     a money-affecting sweep;
 *   - is isolated, so one failure does not stop the others;
 *   - reports through the observability sink rather than only to stdout.
 */
import { randomBytes } from "node:crypto";
import { sweepApprovalExpiry, sweepEscrowTimeouts } from "../engine.js";
import { runAutoFundSweep } from "../auto-fund.js";
import { runOnchainDepositSweep } from "../chain/sync-deposits.js";
import { recordObs } from "../platform/observability.js";
import { store } from "../store.js";
import { checkVaultGas } from "./gas-monitor.js";
import { recoverStuckSettlements } from "./settlement-recovery.js";
import { runDueSubscriptions } from "./subscriptions.js";

export interface JobDefinition {
  name: string;
  /** How often to attempt the job. */
  intervalMs: number;
  /**
   * Lease duration. Must exceed the job's worst-case runtime, or a slow run
   * lets a peer start a second copy.
   */
  leaseMs: number;
  run: () => void | Promise<void>;
}

/** Identifies this process in the lock table; survives for its lifetime. */
export const HOLDER_ID = `${process.pid}-${randomBytes(4).toString("hex")}`;

export const JOBS: JobDefinition[] = [
  {
    name: "escrow-timeouts",
    intervalMs: 10_000,
    leaseMs: 60_000,
    run: () => sweepEscrowTimeouts(),
  },
  {
    name: "approval-expiry",
    intervalMs: 10_000,
    leaseMs: 60_000,
    run: () => sweepApprovalExpiry(),
  },
  {
    name: "overdue-invoices",
    intervalMs: 60_000,
    leaseMs: 120_000,
    run: () => {
      for (const orgId of store.listOrgIds()) store.sweepOverdueInvoices(orgId);
    },
  },
  {
    name: "subscriptions",
    intervalMs: 30_000,
    // Charges await a network rail; a short lease would let a peer start a
    // second charge for the same due slot.
    leaseMs: 300_000,
    run: async () => {
      const { charged, parked } = await runDueSubscriptions();
      if (charged || parked) {
        recordObs({ name: "jobs.subscriptions", attrs: { charged, parked } });
      }
    },
  },
  {
    name: "auto-fund",
    intervalMs: 30_000,
    leaseMs: 60_000,
    run: () => {
      const { toppedUp } = runAutoFundSweep({ force: true });
      if (toppedUp) recordObs({ name: "jobs.autoFund", attrs: { toppedUp } });
    },
  },
  {
    name: "onchain-deposits",
    intervalMs: 30_000,
    leaseMs: 120_000,
    run: async () => {
      const { credited } = await runOnchainDepositSweep({ force: true });
      if (credited) recordObs({ name: "jobs.onchainDeposits", attrs: { credited } });
    },
  },
  {
    name: "gas-monitor",
    // Gas drains slowly; hourly is enough lead time and keeps RPC use modest.
    intervalMs: 60 * 60_000,
    leaseMs: 300_000,
    run: async () => {
      const { checked, low } = await checkVaultGas();
      if (low > 0) recordObs({ name: "jobs.gasMonitor", attrs: { checked, low } });
    },
  },
  {
    name: "settlement-recovery",
    // Frequent, because the gap it closes is money already moved that the
    // ledger has not recorded.
    intervalMs: 2 * 60_000,
    leaseMs: 300_000,
    run: async () => {
      const { checked, failed, needsReview } = await recoverStuckSettlements();
      if (checked > 0) {
        recordObs({ name: "jobs.settlementRecovery", attrs: { checked, failed, needsReview } });
      }
    },
  },
  {
    name: "reconcile",
    intervalMs: 60_000,
    leaseMs: 300_000,
    run: () => {
      for (const orgId of store.listOrgIds()) {
        const result = store.reconcileOrg(orgId);
        if (!result.ok) {
          // Books disagreeing with their own journal replay is the loudest
          // signal this system can produce. It must reach a human.
          console.error(`RECONCILE DRIFT org=${orgId}:`, JSON.stringify(result.drift));
          recordObs({
            name: "reconcile.drift",
            orgId,
            attrs: { accounts: result.drift.length },
          });
        }
      }
    },
  },
];

/** Run one job if its lease can be taken. Exposed for tests and for one-shot runs. */
export async function runJobOnce(job: JobDefinition, holder = HOLDER_ID): Promise<boolean> {
  if (!store.acquireJobLock(job.name, holder, job.leaseMs)) return false;
  try {
    await job.run();
    return true;
  } catch (e) {
    console.error(`job ${job.name} failed:`, e);
    recordObs({ name: "jobs.failed", attrs: { job: job.name, error: String(e) } });
    return true;
  } finally {
    store.releaseJobLock(job.name, holder);
  }
}

export interface SchedulerHandle {
  stop: () => void;
}

/**
 * Start every job on its own timer. Timers are unref'd so they never hold a
 * process open on their own — the HTTP listener or the worker's own keepalive
 * decides lifetime.
 */
export function startScheduler(jobs: JobDefinition[] = JOBS): SchedulerHandle {
  const timers = jobs.map((job) => {
    const tick = () => {
      void runJobOnce(job);
    };
    const timer = setInterval(tick, job.intervalMs);
    timer.unref();
    return timer;
  });
  console.log(
    JSON.stringify({
      type: "abi.jobs.started",
      holder: HOLDER_ID,
      jobs: jobs.map((j) => j.name),
    }),
  );
  return {
    stop: () => {
      for (const t of timers) clearInterval(t);
    },
  };
}
