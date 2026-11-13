#!/usr/bin/env node
/**
 * Capture console screenshots for the YC investor demo walkthrough.
 * Requires: local stack up, keys in apps/api/data/yc-demo-keys.json (or --keys),
 * and `npx playwright` with Chromium installed.
 *
 * Usage:
 *   node scripts/demo-capture-console.mjs
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

function loadPlaywright() {
  try {
    return require("playwright");
  } catch {
    // Use the npx-cached playwright package if workspace has none.
    const r = spawnSync("npm", ["root", "-g"], { encoding: "utf8" });
    try {
      return require(resolve("/tmp", "node_modules/playwright"));
    } catch {
      /* fall through */
    }
  }
  // Install into /tmp for this capture only.
  spawnSync("npm", ["install", "playwright@1.64.1", "--prefix", "/tmp/pw"], {
    stdio: "inherit",
  });
  return require("/tmp/pw/node_modules/playwright");
}

const { chromium } = loadPlaywright();

const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const consoleUrl = flag("--url", "http://localhost:3000/console");
const keysPath = resolve(root, flag("--keys", "apps/api/data/yc-demo-keys.json"));
const outDir = resolve(flag("--out", "/opt/cursor/artifacts"));
mkdirSync(outDir, { recursive: true });

if (!existsSync(keysPath)) {
  console.error(`Missing ${keysPath}. Run: npm run demo:bootstrap`);
  process.exit(1);
}
const keys = JSON.parse(readFileSync(keysPath, "utf8"));

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: outDir, size: { width: 1440, height: 900 } },
});
const page = await context.newPage();

async function shot(name) {
  const path = resolve(outDir, name);
  await page.screenshot({ path, fullPage: false });
  console.log(`saved ${path}`);
  return path;
}

async function clickNav(label) {
  // Desktop sidebar buttons contain the label text.
  const item = page.locator("button, a, [role='button']").filter({ hasText: new RegExp(`^${label}$`) }).first();
  await item.click({ timeout: 15000 });
  await page.waitForTimeout(800);
}

await page.goto(consoleUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.getByRole("tab", { name: "Use a key" }).waitFor({ timeout: 30000 });
await page.getByRole("tab", { name: "Use a key" }).click();
await page.getByPlaceholder("pv_guardian_…").fill(keys.guardianKey);
await page.getByRole("button", { name: "Open console" }).click();
await page.getByText("Maya Research Desk", { timeout: 30000 }).waitFor().catch(() => {});
await page.waitForTimeout(2000);
await shot("01-overview.png");

for (const [label, file] of [
  ["Treasury", "02-treasury.png"],
  ["Policies", "03-policies.png"],
  ["API", "04-api-agents.png"],
  ["Approvals", "05-approvals.png"],
]) {
  await clickNav(label);
  await shot(file);
}

// Approve pending if present (UI label is "Approve payment")
const approveBtn = page.getByRole("button", { name: /Approve payment/i }).first();
if ((await approveBtn.count()) > 0) {
  await approveBtn.click();
  await page.waitForTimeout(2000);
  await shot("06-approvals-after.png");
} else {
  console.log("no Approve payment button visible — skipping approve click");
}

for (const [label, file] of [
  ["Transactions", "07-transactions.png"],
  ["Ledger", "08-ledger.png"],
  ["Insights", "09-insights.png"],
  ["Overview", "10-overview-final.png"],
]) {
  await clickNav(label);
  await shot(file);
}

const video = page.video();
await context.close();
await browser.close();
if (video) {
  const vpath = await video.path();
  const dest = resolve(outDir, "abi-investor-demo-console.webm");
  try {
    const { copyFileSync } = await import("node:fs");
    copyFileSync(vpath, dest);
    console.log(`saved ${dest}`);
  } catch (e) {
    console.log(`video at ${vpath}`);
  }
}

writeFileSync(
  resolve(outDir, "demo-capture-index.json"),
  JSON.stringify(
    {
      capturedAt: new Date().toISOString(),
      consoleUrl,
      orgId: keys.orgId,
      files: [
        "01-overview.png",
        "02-treasury.png",
        "03-policies.png",
        "04-api-agents.png",
        "05-approvals.png",
        "06-approvals-after.png",
        "07-transactions.png",
        "08-ledger.png",
        "09-insights.png",
        "10-overview-final.png",
        "abi-investor-demo-console.webm",
      ],
    },
    null,
    2,
  ),
);
console.log("capture complete");
