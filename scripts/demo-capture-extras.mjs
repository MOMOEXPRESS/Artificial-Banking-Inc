#!/usr/bin/env node
import { readFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire("/tmp/pw/package.json");
const { chromium } = require("/tmp/pw/node_modules/playwright");
const keys = JSON.parse(readFileSync("/workspace/apps/api/data/yc-demo-keys.json", "utf8"));
const outDir = "/opt/cursor/artifacts";
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://localhost:3000/console", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.getByRole("tab", { name: "Use a key" }).click();
await page.getByPlaceholder("pv_guardian_…").fill(keys.guardianKey);
await page.getByRole("button", { name: "Open console" }).click();
await page.waitForTimeout(2500);

async function nav(label) {
  await page.locator("button, a").filter({ hasText: new RegExp(`^${label}$`) }).first().click();
  await page.waitForTimeout(800);
}

await nav("Insights");
await page.getByText("Vendors", { exact: true }).click();
await page.waitForTimeout(1000);
await page.screenshot({ path: `${outDir}/09b-insights-vendors.png` });
await page.getByText("Activity", { exact: true }).click();
await page.waitForTimeout(1000);
await page.screenshot({ path: `${outDir}/09c-insights-activity.png` });

await nav("API");
await page.getByText("Agent groups", { exact: true }).click();
await page.waitForTimeout(800);
await page.screenshot({ path: `${outDir}/04b-api-groups.png` });
await page.getByText("Sessions", { exact: true }).click();
await page.waitForTimeout(800);
await page.screenshot({ path: `${outDir}/04c-api-sessions.png` });

await nav("Policies");
await page.getByText("Allowlists", { exact: true }).click();
await page.waitForTimeout(800);
await page.screenshot({ path: `${outDir}/03b-policies-allowlists.png` });

await browser.close();
console.log("extra shots ok");
