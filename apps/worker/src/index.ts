/**
 * ABI background worker.
 *
 * Runs the money-affecting sweeps — escrow timeouts, approval expiry,
 * subscription charges, auto-fund top-ups, on-chain deposit credit, overdue
 * invoices, and the reconciliation watchdog — outside the request path.
 *
 * Run this alongside the API with `ABI_RUN_JOBS=0` set on the API so exactly
 * one of the two owns the jobs. Both take the same database leases, so running
 * both is safe — merely wasteful.
 *
 * Exposes a tiny free HTTP probe on WORKER_HEALTH_PORT (default 8788) so
 * Docker/Fly/Render can health-check without a paid sidecar.
 */
import { createServer } from "node:http";
import { HOLDER_ID, JOBS, startScheduler } from "@policyvault/api/jobs";

const scheduler = startScheduler(JOBS);
const STARTED_AT = Date.now();
const healthPort = Number(process.env.WORKER_HEALTH_PORT ?? 8788);

const healthServer = createServer((req, res) => {
  const url = req.url ?? "/";
  if (url === "/health" || url.startsWith("/health?")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        service: "abi-worker",
        uptimeSec: Math.round((Date.now() - STARTED_AT) / 1000),
        holder: HOLDER_ID,
        jobs: JOBS.length,
      }),
    );
    return;
  }
  if (url === "/ready" || url.startsWith("/ready?")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        service: "abi-worker",
        ready: true,
        holder: HOLDER_ID,
        jobs: JOBS.map((j) => j.name),
      }),
    );
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: { code: "NOT_FOUND" } }));
});

healthServer.listen(healthPort, "0.0.0.0", () => {
  console.log(
    JSON.stringify({
      type: "abi.worker.started",
      holder: HOLDER_ID,
      healthPort,
      jobs: JOBS.map((j) => `${j.name}@${j.intervalMs}ms`),
    }),
  );
});

function shutdown(signal: string) {
  console.log(JSON.stringify({ type: "abi.worker.stopping", signal }));
  scheduler.stop();
  healthServer.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
