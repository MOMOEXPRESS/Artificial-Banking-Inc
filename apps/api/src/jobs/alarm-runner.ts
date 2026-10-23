/**
 * Durable Object alarm tick — run due jobs without setInterval or job leases.
 *
 * Inside a single DO only one alarm/request runs at a time, so lease rows are
 * unnecessary and would burn free-plan rows-written quota.
 *
 * Also runs `retryPendingWebhookDeliveries` (PR #61 durable webhook retries).
 */
import { retryPendingWebhookDeliveries } from "../webhooks.js";
import { JOBS, type JobDefinition } from "./scheduler.js";
import { runWithRpcBudget } from "../chain/rpc-budget.js";
import { store } from "../store.js";

const lastRun = new Map<string, number>();

/** Alarm cadence (apps/api-worker ALARM_MS). Jobs slower than this persist their clock. */
const ALARM_TICK_MS = 60_000;

/**
 * The Durable Object is evicted between ticks, which reset this in-memory map:
 * hourly jobs (gas monitor) and 5-minute jobs (on-chain backing) re-ran every
 * minute. Jobs slower than one tick keep their last-run time in job_state —
 * one row write per run, not per tick.
 */
function lastRunAt(job: JobDefinition): number {
  const mem = lastRun.get(job.name);
  if (mem !== undefined) return mem;
  if (job.intervalMs <= ALARM_TICK_MS) return 0;
  const v = Number(store.getJobState(`last-run:${job.name}`) ?? 0);
  return Number.isFinite(v) ? v : 0;
}

function markRun(job: JobDefinition, now: number): void {
  lastRun.set(job.name, now);
  if (job.intervalMs > ALARM_TICK_MS) store.setJobState(`last-run:${job.name}`, String(now));
}

const WEBHOOK_RETRY_JOB: JobDefinition = {
  name: "webhook-retries",
  intervalMs: 30_000,
  leaseMs: 60_000,
  run: async () => {
    const { attempted } = await retryPendingWebhookDeliveries();
    if (attempted > 0) {
      console.log(JSON.stringify({ type: "abi.jobs.webhookRetries", attempted }));
    }
  },
};

/**
 * Chain reads one tick may make, shared by every job. Workers allows 50
 * subrequests per invocation on the free plan; the rest is headroom for
 * webhook retries and settlement-recovery receipt checks.
 */
export const ALARM_RPC_BUDGET = Number(process.env.ABI_ALARM_RPC_BUDGET ?? 35);

export async function runAlarmJobs(jobs: JobDefinition[] = [...JOBS, WEBHOOK_RETRY_JOB]): Promise<{
  ran: string[];
  skipped: string[];
}> {
  return runWithRpcBudget(ALARM_RPC_BUDGET, () => runAlarmJobsInner(jobs));
}

async function runAlarmJobsInner(jobs: JobDefinition[]): Promise<{
  ran: string[];
  skipped: string[];
}> {
  const now = Date.now();
  const ran: string[] = [];
  const skipped: string[] = [];

  for (const job of jobs) {
    const prev = lastRunAt(job);
    if (now - prev < job.intervalMs) {
      skipped.push(job.name);
      continue;
    }
    try {
      await job.run();
      markRun(job, now);
      ran.push(job.name);
    } catch (error) {
      console.error(`alarm job ${job.name} failed:`, error);
      // Still advance the clock so a hard-failing job cannot monopolize every tick.
      markRun(job, now);
      ran.push(job.name);
    }
  }

  return { ran, skipped };
}
