/**
 * Cloudflare Workers entry surface for the ABI API.
 *
 * Imported only from apps/api-worker after Durable Object SQL is injected.
 * Does not call app.listen; background intervals are replaced by DO alarms.
 */
import { app } from "./index.js";
import { runAlarmJobs } from "./jobs/alarm-runner.js";
import { hashPassword, verifyPassword } from "./auth/password.js";

/** Local spike measurement — only when ABI_SPIKE_ROUTES=1. */
if (process.env.ABI_SPIKE_ROUTES === "1") {
  app.post("/v1/spike/scrypt", async (req, res) => {
    try {
      const password =
        typeof req.body?.password === "string" ? req.body.password : "spike-password-12chars";
      const samples: number[] = [];
      for (let i = 0; i < 3; i++) {
        const t0 = performance.now();
        const stored = await hashPassword(password);
        const ok = await verifyPassword(password, stored);
        samples.push(performance.now() - t0);
        if (!ok) {
          res.status(500).json({ error: "verify failed" });
          return;
        }
      }
      const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
      const max = Math.max(...samples);
      res.json({
        samplesMs: samples.map((n) => Math.round(n * 10) / 10),
        avgMs: Math.round(avg * 10) / 10,
        maxMs: Math.round(max * 10) / 10,
        freeWorkerCpuMs: 10,
        durableObjectCpuMs: 30_000,
        exceedsPlainWorkerLimit: avg > 10,
        fitsDurableObjectLimit: max < 30_000,
        note: "workerd local does not enforce free-plan CPU; confirm on a real free-account deploy.",
        runtime: process.env.ABI_RUNTIME ?? "unknown",
      });
    } catch (error) {
      console.error("spike scrypt failed:", error);
      res.status(500).json({
        error: {
          code: "SPIKE_FAILED",
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  });
}

export { app, runAlarmJobs };
