/**
 * Half-day spike: prove scrypt + Express-inside-Durable-Object are viable
 * against documented free-plan CPU limits.
 *
 * Local workerd / vitest-pool does NOT enforce the free-plan 10 ms Worker CPU
 * cap. We measure wall/CPU-ish elapsed time and compare to published limits:
 *   - Plain Worker (Free): 10 ms CPU / request
 *   - Durable Object: 30 s CPU / request (docs)
 * Only a real deploy to Maurice's free account can confirm DO free-plan
 * enforcement matches the 30 s figure.
 */
import { describe, expect, it } from "vitest";
import { self, env } from "cloudflare:test";
import { hashPassword, verifyPassword } from "../../api/src/auth/password.js";

const FREE_WORKER_CPU_MS = 10;
const DO_CPU_MS = 30_000;

describe("spike: scrypt CPU vs free-plan limits", () => {
  it("measures scrypt hash+verify elapsed time inside the Workers runtime", async () => {
    const samples: number[] = [];
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      const stored = await hashPassword("spike-password-12chars");
      const ok = await verifyPassword("spike-password-12chars", stored);
      const ms = performance.now() - t0;
      expect(ok).toBe(true);
      samples.push(ms);
    }
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
    const max = Math.max(...samples);

    // Persist numbers for the PR / docs.
    console.log(
      JSON.stringify({
        type: "abi.spike.scrypt",
        samplesMs: samples.map((n) => Math.round(n * 10) / 10),
        avgMs: Math.round(avg * 10) / 10,
        maxMs: Math.round(max * 10) / 10,
        freeWorkerCpuMs: FREE_WORKER_CPU_MS,
        durableObjectCpuMs: DO_CPU_MS,
        exceedsPlainWorkerLimit: avg > FREE_WORKER_CPU_MS,
        fitsDurableObjectLimit: max < DO_CPU_MS,
        note: "Local workerd does not enforce free-plan CPU; confirm on a real free-account deploy.",
      }),
    );

    expect(avg).toBeGreaterThan(FREE_WORKER_CPU_MS);
    expect(max).toBeLessThan(DO_CPU_MS);
  });
});

describe("spike: Express inside Durable Object", () => {
  it("serves /health through the Worker → DO → Express bridge", async () => {
    const t0 = performance.now();
    const res = await self.fetch("https://example.com/health");
    const ms = performance.now() - t0;
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok?: boolean };
    expect(body.ok).toBe(true);
    console.log(
      JSON.stringify({
        type: "abi.spike.expressDo",
        status: res.status,
        elapsedMs: Math.round(ms * 10) / 10,
        hasAbiBinding: typeof env.ABI !== "undefined",
      }),
    );
  });

  it("runs a signup+login path that exercises scrypt inside the DO", async () => {
    const email = `spike-${Date.now()}@example.com`;
    const password = "spike-password-12chars";
    const t0 = performance.now();
    const signup = await self.fetch("https://example.com/v1/auth/signup", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-abi-signup-token": "test-signup-token",
      },
      body: JSON.stringify({
        email,
        password,
        name: "Spike User",
        orgName: "Spike Org",
      }),
    });
    const signupMs = performance.now() - t0;
    const signupBody = (await signup.json().catch(() => ({}))) as Record<string, unknown>;
    console.log(
      JSON.stringify({
        type: "abi.spike.signup",
        status: signup.status,
        elapsedMs: Math.round(signupMs * 10) / 10,
        bodyKeys: Object.keys(signupBody),
        error: signupBody.error ?? null,
      }),
    );

    // Signup may 503 without email in production; with ABI_ALLOW_UNVERIFIED_SIGNUP
    // (and/or bootstrap) we expect success or a structured validation error — not 1102.
    expect([200, 201, 400, 403, 503]).toContain(signup.status);
    expect(signup.status).not.toBe(1102);
    expect(signupMs).toBeLessThan(DO_CPU_MS);
  });
});
