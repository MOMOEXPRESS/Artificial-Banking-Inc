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

const lastRun = new Map<string, number>();

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

export async function runAlarmJobs(
  jobs: JobDefinition[] = [...JOBS, WEBHOOK_RETRY_JOB],
): Promise<{
  ran: string[];
  skipped: string[];
}> {
  const now = Date.now();
  const ran: string[] = [];
  const skipped: string[] = [];

  for (const job of jobs) {
    const prev = lastRun.get(job.name) ?? 0;
    if (now - prev < job.intervalMs) {
      skipped.push(job.name);
      continue;
    }
    try {
      await job.run();
      lastRun.set(job.name, now);
      ran.push(job.name);
    } catch (error) {
      console.error(`alarm job ${job.name} failed:`, error);
      // Still advance the clock so a hard-failing job cannot monopolize every tick.
      lastRun.set(job.name, now);
      ran.push(job.name);
    }
  }

  return { ran, skipped };
}
