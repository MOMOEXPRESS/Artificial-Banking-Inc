#!/usr/bin/env node
/**
 * Local Workers verification without the vitest Workers pool (blocked by the
 * repo-wide zod@3 override vs @cloudflare/vitest-plugin's zod@4).
 *
 * Starts `wrangler dev`, hits health / scrypt spike / telegram webhook /
 * openapi, writes JSON evidence under /opt/cursor/artifacts.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const appDir = join(root, "..");
const artifactDir = "/opt/cursor/artifacts";
mkdirSync(artifactDir, { recursive: true });

const PORT = Number(process.env.ABI_WORKER_DEV_PORT ?? 8799);
const BASE = `http://127.0.0.1:${PORT}`;

const env = {
  ...process.env,
  ABI_SPIKE_ROUTES: "1",
  ABI_KEK: process.env.ABI_KEK ?? "local-verify-kek-32-bytes-base64-test!!!!",
  ABI_KEY_PEPPER: process.env.ABI_KEY_PEPPER ?? "local-verify-pepper",
  ABI_SIGNUP_TOKEN: process.env.ABI_SIGNUP_TOKEN ?? "test-signup-token",
  TELEGRAM_WEBHOOK_SECRET: process.env.TELEGRAM_WEBHOOK_SECRET ?? "telegram-webhook-secret-test",
  ABI_ALLOW_UNVERIFIED_SIGNUP: "1",
  POLICYVAULT_ALLOW_BOOTSTRAP: "1",
  CHAIN: "base-sepolia",
};

const child = spawn(
  "npx",
  [
    "wrangler",
    "dev",
    "--local",
    "--ip",
    "127.0.0.1",
    "--port",
    String(PORT),
    "--var",
    "ABI_SPIKE_ROUTES:1",
  ],
  {
    cwd: appDir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  },
);

let output = "";
child.stdout.on("data", (d) => {
  output += d.toString();
  process.stdout.write(d);
});
child.stderr.on("data", (d) => {
  output += d.toString();
  process.stderr.write(d);
});

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitReady(timeoutMs = 90_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    if (child.exitCode != null) {
      throw new Error(`wrangler exited early (${child.exitCode})\n${output.slice(-4000)}`);
    }
    await sleep(500);
  }
  throw new Error(`wrangler dev not ready within ${timeoutMs}ms\n${output.slice(-4000)}`);
}

async function main() {
  const results = { ok: true, steps: [] };
  try {
    await waitReady();

    const health = await fetch(`${BASE}/health`);
    const healthBody = await health.json();
    results.steps.push({ name: "health", status: health.status, body: healthBody });

    const scrypt = await fetch(`${BASE}/v1/spike/scrypt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "spike-password-12chars" }),
    });
    const scryptBody = await scrypt.json();
    results.steps.push({ name: "scrypt", status: scrypt.status, body: scryptBody });

    const tgBad = await fetch(`${BASE}/v1/telegram/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": "wrong",
      },
      body: "{}",
    });
    results.steps.push({ name: "telegram_bad_secret", status: tgBad.status });

    const tgGood = await fetch(`${BASE}/v1/telegram/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": env.TELEGRAM_WEBHOOK_SECRET,
      },
      body: JSON.stringify({ update_id: 1 }),
    });
    results.steps.push({ name: "telegram_good_secret", status: tgGood.status });

    const openapi = await fetch(`${BASE}/v1/openapi.json`);
    results.steps.push({ name: "openapi", status: openapi.status });

    const email = `verify-${Date.now()}@example.com`;
    const signup = await fetch(`${BASE}/v1/auth/signup`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-abi-signup-token": env.ABI_SIGNUP_TOKEN,
      },
      body: JSON.stringify({
        email,
        password: "workers-test-pass-12",
        name: "Verify User",
        orgName: "Verify Org",
      }),
    });
    const signupBody = await signup.json().catch(() => ({}));
    results.steps.push({ name: "signup", status: signup.status, body: signupBody });

    // Assertions
    if (health.status !== 200 || healthBody.ok !== true) results.ok = false;
    if (
      scrypt.status !== 200 ||
      !scryptBody.exceedsPlainWorkerLimit ||
      !scryptBody.fitsDurableObjectLimit
    ) {
      results.ok = false;
    }
    if (tgBad.status !== 401 || tgGood.status !== 200) results.ok = false;
    if (openapi.status !== 200) results.ok = false;

    writeFileSync(join(artifactDir, "workers-verify.json"), JSON.stringify(results, null, 2));
    writeFileSync(join(artifactDir, "spike-results.json"), JSON.stringify(scryptBody, null, 2));
    console.log(
      JSON.stringify({ type: "abi.verify.summary", ok: results.ok, scrypt: scryptBody }, null, 2),
    );
    if (!results.ok) process.exitCode = 1;
  } catch (error) {
    results.ok = false;
    results.error = error instanceof Error ? error.message : String(error);
    writeFileSync(join(artifactDir, "workers-verify.json"), JSON.stringify(results, null, 2));
    console.error(results.error);
    process.exitCode = 1;
  } finally {
    try {
      child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
    await sleep(300);
    if (child.exitCode == null) {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }
    // workerd children can outlive wrangler briefly in local mode
    await sleep(200);
  }
}

main();
