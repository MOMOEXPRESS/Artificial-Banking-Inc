/**
 * ABI background worker.
 *
 * Runs the money-affecting sweeps — escrow timeouts, approval expiry,
 * subscription charges, auto-fund top-ups, on-chain deposit credit, overdue
 * invoices, and the reconciliation watchdog — outside the request path.
 *
 * This was a 13-line stub that logged a tick and did nothing. The real work sat
 * on `setInterval` inside the API process, behind a gate that was always closed
 * on the serverless deployment, so none of it ran in production: subscriptions
 * never charged, drift was never detected, escrow auto-refund only fired when
 * someone happened to open the right screen.
 *
 * Run this alongside the API with `ABI_RUN_JOBS=0` set on the API so exactly
 * one of the two owns the jobs. Both take the same database leases, so running
 * both is safe — merely wasteful.
 */
import { HOLDER_ID, JOBS, startScheduler } from "@policyvault/api/jobs";

const scheduler = startScheduler(JOBS);

console.log(
  JSON.stringify({
    type: "abi.worker.started",
    holder: HOLDER_ID,
    jobs: JOBS.map((j) => `${j.name}@${j.intervalMs}ms`),
  }),
);

// Unlike the API there is no listener holding this process open, and the
// scheduler's timers are deliberately unref'd — so keep an explicit handle.
const keepAlive = setInterval(() => {}, 1 << 30);

function shutdown(signal: string) {
  console.log(JSON.stringify({ type: "abi.worker.stopping", signal }));
  scheduler.stop();
  clearInterval(keepAlive);
  // Leases expire on their own, so a peer picks the jobs up without waiting for
  // a clean shutdown here.
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
