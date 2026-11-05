#!/usr/bin/env node
/**
 * Seed a disposable Maya Research Desk org for investor / YC demos.
 *
 * Writes keys once to a local gitignored file (default:
 * apps/api/data/yc-demo-keys.json). Never commit that file.
 *
 * Usage:
 *   npm run demo:bootstrap
 *   node scripts/demo-bootstrap.mjs [--api http://localhost:8787] [--out path]
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const api = flag("--api", process.env.ABI_API_ORIGIN || "http://localhost:8787").replace(/\/$/, "");
const out = resolve(root, flag("--out", "apps/api/data/yc-demo-keys.json"));

const health = await fetch(`${api}/health`);
if (!health.ok) {
  console.error(`API not healthy at ${api}/health (${health.status}). Start with: npm run dev`);
  process.exit(1);
}

const statusRes = await fetch(`${api}/v1/demo/status`);
const status = statusRes.ok ? await statusRes.json() : null;
if (status && status.enabled === false) {
  console.error(
    "Demo bootstrap is disabled. In development leave POLICYVAULT_ALLOW_BOOTSTRAP unset or set it to 1.",
  );
  process.exit(1);
}

const res = await fetch(`${api}/v1/demo/bootstrap`, { method: "POST" });
const body = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`Bootstrap failed (${res.status}):`, body?.error?.message || body);
  process.exit(1);
}

mkdirSync(dirname(out), { recursive: true });
const record = {
  createdAt: new Date().toISOString(),
  api,
  orgId: body.orgId,
  orgName: "Maya Research Desk",
  vaultAddress: body.vaultAddress,
  orgAvailableUsdc: body.orgAvailableUsdc,
  researcherAgentId: body.researcherAgentId,
  writerAgentId: body.writerAgentId,
  guardianKey: body.guardianKey,
  agentApiKey: body.agentApiKey,
  writerApiKey: body.writerApiKey,
  note: "Treat keys like root passwords. Demo ledger float is not on-chain USDC.",
};
writeFileSync(out, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });

const redact = (s) => (typeof s === "string" && s.length > 12 ? `${s.slice(0, 8)}…${s.slice(-4)}` : "***");
console.log(`Seeded ${record.orgName} (${record.orgId})`);
console.log(`  vault:           ${record.vaultAddress}`);
console.log(`  org available:   $${record.orgAvailableUsdc} (+ $40 in Research budget)`);
console.log(`  guardianKey:     ${redact(record.guardianKey)}`);
console.log(`  agentApiKey:     ${redact(record.agentApiKey)}  (Researcher)`);
console.log(`  keys written to: ${out}`);
console.log("");
console.log("Next: open http://localhost:3000/console → Use a key → paste guardianKey");
console.log("Playground: paste agentApiKey, run scenario “Large purchase (needs your approval)”");
console.log("See docs/demo/YC-INVESTOR-DEMO.md for the full recording checklist.");
