#!/usr/bin/env node
/**
 * End-to-end HITL dry-run for the investor demo (no browser).
 *
 * Uses keys from apps/api/data/yc-demo-keys.json (or --keys path), or
 * bootstraps a fresh org when --bootstrap is passed.
 *
 * Flow: agent pay $15 → review → guardian approve → ledger + vendors check.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const wantBootstrap = args.includes("--bootstrap");
function flag(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const api = flag("--api", process.env.ABI_API_ORIGIN || "http://localhost:8787").replace(/\/$/, "");
const keysPath = resolve(root, flag("--keys", "apps/api/data/yc-demo-keys.json"));

async function json(method, path, token, body) {
  const res = await fetch(`${api}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

let guardianKey;
let agentApiKey;

if (wantBootstrap || !existsSync(keysPath)) {
  const boot = await json("POST", "/v1/demo/bootstrap");
  if (boot.status >= 400) {
    console.error("Bootstrap failed:", boot.data);
    process.exit(1);
  }
  guardianKey = boot.data.guardianKey;
  agentApiKey = boot.data.agentApiKey;
  console.log(`Bootstrapped org ${boot.data.orgId}`);
} else {
  const keys = JSON.parse(readFileSync(keysPath, "utf8"));
  guardianKey = keys.guardianKey;
  agentApiKey = keys.agentApiKey;
  console.log(`Using keys from ${keysPath} (${keys.orgId || "unknown org"})`);
}

const pay = await json("POST", "/v1/agent/pay_api", agentApiKey, {
  amountUsdc: "15",
  destination: "api.openai.com",
  memo: "bulk dataset licence",
  idempotencyKey: randomUUID(),
});

if (pay.status !== 202 || pay.data.outcome !== "review" || !pay.data.approvalId) {
  console.error("Expected 202 review with approvalId, got:", pay.status, pay.data);
  process.exit(1);
}
console.log(`Parked: approval ${pay.data.approvalId} (rule: ${pay.data.error?.rule_code || "hitl"})`);

const approved = await json(
  "POST",
  `/v1/guardian/approvals/${pay.data.approvalId}/resolve`,
  guardianKey,
  { approve: true },
);
if (approved.status >= 400 || approved.data?.approval?.status !== "approved") {
  console.error("Approve failed:", approved.status, approved.data);
  process.exit(1);
}
console.log(`Approved: ${approved.data.approval.id}`);

const intent = await json("GET", `/v1/agent/intents/${pay.data.intentId}/status`, agentApiKey);
if (intent.data?.state !== "settled") {
  console.error("Intent not settled:", intent.data);
  process.exit(1);
}

const journals = await json("GET", "/v1/guardian/journals", guardianKey);
const memos = (journals.data.journals || []).map((j) => j.memo);
const vendors = await json("GET", "/v1/guardian/vendors", guardianKey);
const vendor = (vendors.data.vendors || []).find((v) => v.vendor === "api.openai.com");

console.log(`Intent settled. Journals include: ${memos.slice(0, 5).join(", ")}`);
console.log(
  `Vendor api.openai.com: $${vendor?.totalUsdc ?? "0"} across ${vendor?.payments ?? 0} payment(s)`,
);
console.log("HITL dry-run OK");
