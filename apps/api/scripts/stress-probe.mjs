#!/usr/bin/env node
/**
 * Lightweight API stress / performance probe for ABI.
 * Usage:
 *   POLICYVAULT_API_URL=http://localhost:8787 node apps/api/scripts/stress-probe.mjs
 * Optional: GUARDIAN_KEY, AGENT_KEY, CONCURRENCY, ROUNDS
 */
const base = process.env.POLICYVAULT_API_URL ?? "http://localhost:8787";
const concurrency = Number(process.env.CONCURRENCY ?? 8);
const rounds = Number(process.env.ROUNDS ?? 5);

async function bootstrap() {
  const res = await fetch(`${base}/v1/demo/bootstrap`, { method: "POST" });
  if (!res.ok) throw new Error(`bootstrap failed ${res.status}`);
  return res.json();
}

async function timed(label, fn) {
  const t0 = performance.now();
  let ok = 0;
  let fail = 0;
  const errors = [];
  await fn({
    ok: () => {
      ok++;
    },
    fail: (e) => {
      fail++;
      if (errors.length < 5) errors.push(String(e));
    },
  });
  const ms = performance.now() - t0;
  return { label, ok, fail, ms, rps: ok / (ms / 1000), errors };
}

async function main() {
  const health = await fetch(`${base}/health`).catch(() => null);
  if (!health?.ok) {
    console.error(`API not reachable at ${base} — start with npm run dev:api`);
    process.exit(2);
  }

  let guardianKey = process.env.GUARDIAN_KEY;
  let agentKey = process.env.AGENT_KEY;
  if (!guardianKey || !agentKey) {
    const boot = await bootstrap();
    guardianKey = boot.guardianKey;
    agentKey = boot.agentApiKey;
    console.log(`bootstrapped org ${boot.orgId}`);
  }

  const gHeaders = {
    Authorization: `Bearer ${guardianKey}`,
    "Content-Type": "application/json",
  };
  const aHeaders = {
    Authorization: `Bearer ${agentKey}`,
    "Content-Type": "application/json",
  };

  const results = [];

  results.push(
    await timed("GET /v1/guardian/org ×N", async ({ ok, fail }) => {
      const jobs = [];
      for (let r = 0; r < rounds; r++) {
        for (let c = 0; c < concurrency; c++) {
          jobs.push(
            fetch(`${base}/v1/guardian/org`, { headers: gHeaders })
              .then((res) => (res.ok ? ok() : fail(res.status)))
              .catch(fail),
          );
        }
      }
      await Promise.all(jobs);
    }),
  );

  results.push(
    await timed("GET /v1/agent/budget ×N", async ({ ok, fail }) => {
      const jobs = [];
      for (let r = 0; r < rounds; r++) {
        for (let c = 0; c < concurrency; c++) {
          jobs.push(
            fetch(`${base}/v1/agent/budget`, { headers: aHeaders })
              .then((res) => (res.ok ? ok() : fail(res.status)))
              .catch(fail),
          );
        }
      }
      await Promise.all(jobs);
    }),
  );

  results.push(
    await timed("POST /v1/agent/simulate ×N", async ({ ok, fail }) => {
      const jobs = [];
      for (let r = 0; r < rounds; r++) {
        for (let c = 0; c < concurrency; c++) {
          jobs.push(
            fetch(`${base}/v1/agent/simulate`, {
              method: "POST",
              headers: aHeaders,
              body: JSON.stringify({
                tool: "pay_api",
                amountUsdc: "1",
                destination: "api.openai.com",
              }),
            })
              .then((res) => (res.ok ? ok() : fail(res.status)))
              .catch(fail),
          );
        }
      }
      await Promise.all(jobs);
    }),
  );

  results.push(
    await timed("GET /v1/guardian/activity ×N", async ({ ok, fail }) => {
      const jobs = [];
      for (let r = 0; r < rounds; r++) {
        for (let c = 0; c < concurrency; c++) {
          jobs.push(
            fetch(`${base}/v1/guardian/activity`, { headers: gHeaders })
              .then((res) => (res.ok ? ok() : fail(res.status)))
              .catch(fail),
          );
        }
      }
      await Promise.all(jobs);
    }),
  );

  console.log("\nABI stress probe");
  console.log(`base=${base} concurrency=${concurrency} rounds=${rounds}`);
  console.log("─".repeat(72));
  for (const r of results) {
    console.log(
      `${r.label.padEnd(32)} ok=${String(r.ok).padStart(4)} fail=${String(r.fail).padStart(3)}  ${r.ms.toFixed(0).padStart(6)}ms  ~${r.rps.toFixed(1)} rps`,
    );
    if (r.errors.length) console.log(`  sample errors: ${r.errors.join(" | ")}`);
  }
  const failed = results.reduce((a, r) => a + r.fail, 0);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
