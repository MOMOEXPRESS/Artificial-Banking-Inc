#!/usr/bin/env node
/**
 * Generate the secrets a hosted ABI deploy needs, and print them grouped by
 * where they must be pasted.
 *
 * Usage:
 *   node scripts/print-deploy-env.mjs \
 *     --console-url https://your-console.vercel.app \
 *     --api-url https://your-api.onrender.com
 *
 * Nothing is written to disk. Copy the values into Render and Vercel, then
 * redeploy both. Env vars only take effect on a new deployment.
 */
import { randomBytes } from "node:crypto";

function arg(name, fallback = "") {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1].replace(/\/$/, "");
  return fallback;
}

const secret = () => randomBytes(32).toString("base64");

const consoleUrl = arg("console-url", "https://YOUR-CONSOLE.vercel.app");
const apiUrl = arg("api-url", "https://YOUR-API.onrender.com");

const ABI_KEK = secret();
const ABI_KEY_PEPPER = secret();
const ABI_SIGNUP_TOKEN = secret();

const render = {
  NODE_ENV: "production",
  PORT: "8787",
  POLICYVAULT_DB: "/data/policyvault.db",
  ABI_KEK,
  ABI_KEY_PEPPER,
  ABI_SIGNUP_TOKEN,
  ABI_CONSOLE_URL: consoleUrl,
  ABI_CORS_ORIGINS: consoleUrl,
  ABI_RUN_JOBS: "1",
  POLICYVAULT_ALLOW_BOOTSTRAP: "0",
  POLICYVAULT_ALLOW_PUBLIC_ORG_CREATE: "0",
  ABI_ALLOW_LOCAL_TARGETS: "0",
  CHAIN: "base-sepolia",
  CHAIN_RPC_URL: "(paid Base RPC — Alchemy/Infura/QuickNode)",
};

const vercel = {
  ABI_API_ORIGIN: apiUrl,
  ABI_SIGNUP_TOKEN,
  NEXT_PUBLIC_API_URL: "/abi-api",
};

function block(title, rows) {
  console.log(`\n── ${title} ──`);
  for (const [k, v] of Object.entries(rows)) {
    console.log(`${k}=${v}`);
  }
}

console.log(`Artificial Banking Inc — deploy env (generated ${new Date().toISOString()})
Do not commit these values. Back up ABI_KEK offline: lose it and every vault key is unrecoverable.

After pasting:
  1. Render → abi-api → Environment → Save → Manual Deploy
  2. Vercel → artificial-banking-inc → Settings → Environment Variables (Production)
  3. Vercel → Deployments → ⋯ on latest Production → Redeploy (or push to main)
  4. Confirm:  curl ${consoleUrl}/abi-api/health
     Expect:   {"ok":true,"service":"abi-api"}
  5. Probe:    node scripts/check-login-api.mjs ${consoleUrl}
`);

block("Render / Railway / Fly / VPS  (API process)", render);
block("Vercel  (console project, Production + Preview)", vercel);

console.log(`
Optional (same API service):
  CDP_API_KEY_ID=
  CDP_API_KEY_SECRET=
  TELEGRAM_BOT_TOKEN=
  TELEGRAM_CHAT_ID=
  RESEND_API_KEY=
  ABI_NOTIFY_EMAIL_TO=
  SLACK_WEBHOOK_URL=

Disk: the API SQLite file MUST sit on a persistent volume (Render blueprint mounts /data).
Without it every redeploy wipes users, so login returns "Email or password is incorrect."
`);
