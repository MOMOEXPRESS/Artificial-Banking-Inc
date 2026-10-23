/**
 * Temporary measurement routes for the free-plan CPU spike.
 * Mounted only when ABI_SPIKE_ROUTES=1 (local verify script).
 */
import type express from "express";
import { hashPassword, verifyPassword } from "@policyvault/api/password";

export function registerSpikeRoutes(app: express.Express): void {
  if (process.env.ABI_SPIKE_ROUTES !== "1") return;

  app.post("/v1/spike/scrypt", async (req, res) => {
    const password =
      typeof req.body?.password === "string" ? req.body.password : "spike-password-12chars";
    const samples: number[] = [];
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      const stored = await hashPassword(password);
      const ok = await verifyPassword(password, stored);
      samples.push(performance.now() - t0);
      if (!ok) {
        return res.status(500).json({ error: "verify failed" });
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
  });
}
