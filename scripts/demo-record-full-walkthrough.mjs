#!/usr/bin/env node
/**
 * YC / investor demo recording (tight pacing):
 *   home → quick marketing skim → sign-in → Overview →
 *   Treasury (copy vault) → Circle faucet (network + address + send) →
 *   Sync / Budgets → Policies Schedule & rules (quiet hours 02–06 UTC) →
 *   Playground Large purchase (HITL) → Approvals → Work →
 *   Transactions Recent → Insights (vendors / forecast / anomalies / activity)
 *
 * Skips: Ledger, API keys, Batch, Rails.
 *
 *   PLAYWRIGHT_BROWSERS_PATH=/tmp/pw/node_modules/playwright-core/.local-browsers \
 *   NODE_PATH=/tmp/pw/node_modules node scripts/demo-record-full-walkthrough.mjs
 */
import { readFileSync, mkdirSync, copyFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

process.env.PLAYWRIGHT_BROWSERS_PATH ||=
  "/tmp/pw/node_modules/playwright-core/.local-browsers";

const require = createRequire("/tmp/pw/package.json");
const { chromium } = require("/tmp/pw/node_modules/playwright");

const BASE = process.env.DEMO_BASE_URL || "http://localhost:3000";
const OUT = resolve(process.env.DEMO_OUT_DIR || "/opt/cursor/artifacts");
const CREDS_PATH = process.env.DEMO_CREDS || "/tmp/abi-full-demo-creds.json";
mkdirSync(OUT, { recursive: true });

if (!existsSync(CREDS_PATH)) {
  console.error(`Missing ${CREDS_PATH}`);
  process.exit(1);
}
const creds = JSON.parse(readFileSync(CREDS_PATH, "utf8"));

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function clickNav(page, label) {
  const item = page
    .locator("nav button, aside button, .sidebar button, button")
    .filter({ hasText: new RegExp(`^${label}$`) })
    .first();
  await item.click({ timeout: 20000 });
  await pause(550);
}

async function clickTab(page, label) {
  const tab = page.getByRole("tab", { name: new RegExp(`^${label}$`, "i") }).first();
  if ((await tab.count()) > 0) await tab.click();
  else {
    const soft = page.getByRole("tab", { name: new RegExp(label, "i") }).first();
    if ((await soft.count()) > 0) await soft.click();
    else await page.getByText(label, { exact: true }).first().click();
  }
  await pause(450);
}

async function shot(page, name) {
  const path = resolve(OUT, name);
  await page.screenshot({ path, fullPage: false });
  console.log("shot", name);
}

const browser = await chromium.launch({
  headless: true,
  slowMo: 35,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: OUT, size: { width: 1440, height: 900 } },
});
const page = await context.newPage();
page.setDefaultTimeout(28000);

const log = [];
function step(msg) {
  console.log(`→ ${msg}`);
  log.push({ at: new Date().toISOString(), msg });
}

let fatal = null;

try {
  // -------- Marketing (home at comfortable pace; others skim) --------
  step("Home");
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await pause(1600);
  await page.evaluate(() => window.scrollTo({ top: 700, behavior: "smooth" }));
  await pause(900);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await pause(600);
  await shot(page, "full-01-home.png");

  for (const [path, file] of [
    ["/docs", "full-02-docs.png"],
    ["/pricing", "full-03-pricing.png"],
    ["/about", "full-05-about.png"],
  ]) {
    step(`Marketing ${path}`);
    await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
    await pause(700);
    await shot(page, file);
  }

  // -------- Sign in --------
  step("Console sign-in");
  await page.goto(`${BASE}/console`, { waitUntil: "domcontentloaded" });
  await pause(800);
  await page.getByRole("tab", { name: /Sign in/i }).click().catch(() => {});
  await pause(250);
  await page.getByPlaceholder("you@company.com").fill(creds.email);
  await page.locator('input[type="password"]').first().fill(creds.password);
  await shot(page, "full-10-signin.png");
  await page.getByRole("button", { name: /^Sign in$/i }).click();
  await page.getByText("Maya Research Desk", { timeout: 45000 }).waitFor();
  await pause(1200);
  await shot(page, "full-11-overview.png");
  for (const re of [/got it/i, /dismiss/i, /close/i, /skip/i]) {
    await page.getByRole("button", { name: re }).first().click({ timeout: 500 }).catch(() => {});
  }

  // -------- Overview (quick) --------
  step("Overview glance");
  await clickNav(page, "Overview");
  await pause(900);
  await shot(page, "full-11b-overview.png");

  // -------- Treasury: copy vault address (do not linger) --------
  step("Treasury Fund — copy vault");
  await clickNav(page, "Treasury");
  await clickTab(page, "Fund").catch(() => clickTab(page, "Vault").catch(() => {}));
  await pause(700);
  await shot(page, "full-17-treasury-fund.png");
  const copyBtn = page.getByRole("button", { name: /copy/i }).first();
  if ((await copyBtn.count()) > 0) await copyBtn.click().catch(() => {});
  await pause(400);

  // -------- Circle faucet (visible navigation — YC funding story) --------
  step("Navigate to Circle faucet");
  const faucet = await context.newPage();
  await faucet.goto("https://faucet.circle.com/", {
    waitUntil: "domcontentloaded",
    timeout: 90000,
  });
  await pause(1800);
  await faucet.screenshot({ path: resolve(OUT, "full-18-circle-faucet.png") });

  await faucet.getByText(/^USDC$/i).first().click({ timeout: 4000 }).catch(() => {});
  await pause(400);

  // Network → Base Sepolia
  const net = faucet.getByLabel(/Network/i).first();
  if ((await net.count()) > 0) {
    await net.click().catch(() => {});
    await pause(350);
  }
  await faucet.getByText(/Base Sepolia/i).first().click({ timeout: 5000 }).catch(() => {});
  await pause(500);

  if (creds.vaultAddress) {
    const addr = faucet
      .getByPlaceholder(/Wallet address/i)
      .or(faucet.getByLabel(/Send to/i))
      .or(faucet.locator('input[placeholder*="address" i]'))
      .first();
    await addr.click({ clickCount: 3 }).catch(() => {});
    await addr.fill(creds.vaultAddress);
    await pause(700);
    const val = await addr.inputValue().catch(() => "");
    step(`Faucet address: ${val.slice(0, 14)}…`);
  }
  await faucet.screenshot({ path: resolve(OUT, "full-19-faucet-address.png") });

  // Attempt send (reCAPTCHA may block — still show the click)
  await faucet
    .getByRole("button", { name: /Send 20 USDC|Send/i })
    .first()
    .click({ timeout: 5000 })
    .catch(() => {});
  await pause(2200);
  await faucet.screenshot({ path: resolve(OUT, "full-19b-faucet-submit.png") });
  // Keep faucet tab briefly visible, then return
  await pause(800);
  await faucet.close().catch(() => {});

  // -------- Back: Sync + Budgets (allocation) --------
  step("Treasury sync + budgets");
  await page.bringToFront();
  await clickNav(page, "Treasury");
  await clickTab(page, "Fund").catch(() => clickTab(page, "Vault").catch(() => {}));
  const sync = page.getByRole("button", { name: /sync/i }).first();
  if ((await sync.count()) > 0) {
    await sync.click().catch(() => {});
    await pause(1600);
    // Second sync — “waiting for arrival”
    await sync.click().catch(() => {});
    await pause(1200);
  }
  await shot(page, "full-21-treasury-after-sync.png");

  await clickTab(page, "Budgets").catch(() => {});
  await pause(700);
  await shot(page, "full-22-treasury-budgets.png");
  // Open Move briefly to show funding budgets
  await clickTab(page, "Move").catch(() => {});
  await pause(600);
  await shot(page, "full-22b-treasury-move.png");

  // -------- Policies: Schedule & rules — quiet hours 02:00–06:00 UTC --------
  step("Policies quiet hours 02–06");
  await clickNav(page, "Policies");
  await clickTab(page, "Schedule & rules").catch(async () => {
    await page.getByRole("tab", { name: /Schedule/i }).first().click().catch(() => {});
  });
  await pause(700);
  await shot(page, "full-28-policies-rules-before.png");

  const quietToggle = page.getByRole("button", { name: /Toggle quiet hours/i }).first();
  if ((await quietToggle.count()) > 0) {
    const on = await quietToggle.evaluate((el) => el.classList.contains("on")).catch(() => false);
    if (!on) await quietToggle.click();
    await pause(400);
  } else {
    await page.locator("button.switch").first().click().catch(() => {});
    await pause(400);
  }

  // From 02:00 / Until 06:00 UTC
  const fromSel = page.getByLabel(/From \(UTC\)/i).first();
  const untilSel = page.getByLabel(/Until \(UTC\)/i).first();
  if ((await fromSel.count()) > 0) {
    await fromSel.selectOption({ value: "2" });
    await untilSel.selectOption({ value: "6" });
  } else {
    const fields = page.locator(".card:has-text('Quiet hours') select");
    if ((await fields.count()) >= 2) {
      await fields.nth(0).selectOption({ value: "2" }).catch(() => {});
      await fields.nth(1).selectOption({ value: "6" }).catch(() => {});
    }
  }
  const actionSel = page.getByLabel(/During those hours/i).first();
  if ((await actionSel.count()) > 0) {
    await actionSel.selectOption({ value: "review" }).catch(() => {});
  }
  await pause(500);
  await shot(page, "full-28b-quiet-hours.png");

  const save = page.getByRole("button", { name: /save policy/i }).first();
  if ((await save.count()) > 0 && (await save.isEnabled().catch(() => false))) {
    await save.click();
    await pause(1000);
  }
  await shot(page, "full-30-policies-after.png");

  // Quick Allowlists glance (vendors already set)
  await clickTab(page, "Allowlists").catch(() => {});
  await pause(500);
  await shot(page, "full-29-policies-allowlists.png");

  // -------- Playground: Large purchase (HITL) --------
  step("Playground Large purchase");
  await clickNav(page, "Playground");
  await pause(1000);

  if (creds.agentApiKey) {
    const keyBox = page.getByLabel(/Agent key/i).or(page.getByPlaceholder(/pv_agent/i)).first();
    if ((await keyBox.count()) > 0) {
      await keyBox.fill(creds.agentApiKey);
      await page.getByRole("button", { name: /^Add$/i }).click();
      await pause(1000);
    }
  }

  const scenarioCard = page
    .locator(".scenario-card")
    .filter({ hasText: /Large purchase \(needs your approval\)/i })
    .first();
  await scenarioCard.scrollIntoViewIfNeeded().catch(() => {});
  await scenarioCard.click();
  await pause(600);
  const briefingTitle = page.locator(".lab-briefing-title h2, .lab-briefing h2").first();
  for (let i = 0; i < 8; i++) {
    const t = ((await briefingTitle.innerText().catch(() => "")) || "").trim();
    if (/Large purchase/i.test(t)) break;
    await scenarioCard.click().catch(() => {});
    await pause(350);
  }
  step(`Scenario: ${((await briefingTitle.innerText().catch(() => "")) || "").trim()}`);
  await page.getByTestId("run-button").scrollIntoViewIfNeeded().catch(() => {});
  await shot(page, "full-31-playground-scenario.png");

  const runBtn = page.getByTestId("run-button");
  for (let i = 0; i < 16; i++) {
    if (await runBtn.isEnabled().catch(() => false)) break;
    await pause(400);
  }
  if (!(await runBtn.isEnabled())) throw new Error("Playground Run stayed disabled");
  await runBtn.click();
  step("Waiting for park");
  await page
    .getByText(/Approval needed|waiting for your decision|Amount requires human approval/i)
    .first()
    .waitFor({ timeout: 60000 });
  await pause(1000);
  await shot(page, "full-32-playground-parked.png");

  // -------- Approvals --------
  step("Approve payment");
  await page.getByRole("button", { name: /Review/i }).first().click({ timeout: 2500 }).catch(() => {});
  await clickNav(page, "Approvals");
  await pause(900);
  let approve = page.getByRole("button", { name: /Approve payment/i }).first();
  for (let i = 0; i < 10 && (await approve.count()) === 0; i++) {
    await pause(700);
    if (i === 3 || i === 7) await clickNav(page, "Approvals");
    approve = page.getByRole("button", { name: /Approve payment/i }).first();
  }
  await shot(page, "full-33-approvals-pending.png");
  if ((await approve.count()) === 0) throw new Error("No Approve payment button");
  await approve.click();
  await pause(2800);
  await shot(page, "full-34-approvals-done.png");

  // Optional second scenario for Insights vendor burn (fast)
  step("Vendor burst for Insights");
  await clickNav(page, "Playground");
  await pause(800);
  await page.getByRole("button", { name: /^Resume$/i }).first().click({ timeout: 2000 }).catch(() => {});
  await pause(800);
  const burst = page
    .locator(".scenario-card")
    .filter({ hasText: /Vendor burst \(micro-payments\)/i })
    .first();
  if ((await burst.count()) > 0) {
    await burst.scrollIntoViewIfNeeded().catch(() => {});
    await burst.click();
    await pause(500);
    const rb = page.getByTestId("run-button");
    if (await rb.isEnabled().catch(() => false)) {
      await rb.click();
      await page
        .getByText(/complete|Vendor burst|deliverable|3\/|done/i)
        .first()
        .waitFor({ timeout: 45000 })
        .catch(() => {});
      await pause(900);
    }
  }
  await shot(page, "full-34b-playground-after.png");

  // -------- Work --------
  step("Work");
  await clickNav(page, "Work");
  await pause(1000);
  const largeDone = page
    .locator("button.mission-card")
    .filter({ hasText: /Large purchase \(needs your approval\)/i })
    .filter({ hasText: /complete/i })
    .filter({ hasText: /\$15/i })
    .first();
  if ((await largeDone.count()) > 0) await largeDone.click();
  else {
    await page
      .locator("button.mission-card")
      .filter({ hasText: /Large purchase/i })
      .filter({ hasText: /complete/i })
      .first()
      .click()
      .catch(() => {});
  }
  await pause(1000);
  await shot(page, "full-36-work.png");
  const bill = page.getByRole("button", { name: /Bill this work/i }).first();
  if ((await bill.count()) > 0 && (await bill.isEnabled().catch(() => false))) {
    await bill.click().catch(() => {});
    await pause(1500);
  }
  await shot(page, "full-37-work-detail.png");

  // -------- Transactions: last activity --------
  step("Transactions Recent");
  await clickNav(page, "Transactions");
  await clickTab(page, "Recent").catch(() => {});
  await pause(900);
  await shot(page, "full-35-tx-recent-after.png");

  // -------- Insights (effects from spend) --------
  step("Insights after spend");
  await clickNav(page, "Insights");
  await pause(700);
  await shot(page, "full-12-insights-pnl.png");
  for (const [tab, file] of [
    ["Vendors", "full-13-insights-vendors.png"],
    ["Forecast", "full-14-insights-forecast.png"],
    ["Anomalies", "full-15-insights-anomalies.png"],
    ["Activity", "full-16-insights-activity.png"],
  ]) {
    await clickTab(page, tab);
    await shot(page, file);
  }

  step("Overview close");
  await clickNav(page, "Overview");
  await pause(1000);
  await shot(page, "full-38-overview-final.png");
} catch (e) {
  fatal = e;
  console.error("Walkthrough error:", e);
  await page.screenshot({ path: resolve(OUT, "full-ERROR.png") }).catch(() => {});
  log.push({ at: new Date().toISOString(), msg: `ERROR: ${String(e)}` });
}

const video = page.video();
await context.close();
await browser.close();

let videoSrc = null;
let mp4Ok = false;
if (video) {
  videoSrc = await video.path();
  const destWebm = resolve(OUT, "abi-full-investor-demo.webm");
  copyFileSync(videoSrc, destWebm);
  console.log("saved", destWebm);
  const mp4 = resolve(OUT, "abi-full-investor-demo.mp4");
  const ff = spawnSync(
    "ffmpeg",
    ["-y", "-i", destWebm, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4],
    { encoding: "utf8" },
  );
  if (ff.status === 0) {
    mp4Ok = true;
    console.log("saved", mp4);
  } else console.error(ff.stderr?.slice(-800));
}

writeFileSync(
  resolve(OUT, "full-demo-log.json"),
  JSON.stringify(
    {
      log,
      credsEmail: creds.email,
      vaultAddress: creds.vaultAddress,
      videoSrc,
      mp4Ok,
      fatal: fatal ? String(fatal) : null,
    },
    null,
    2,
  ),
);
console.log("done", fatal ? "WITH_ERRORS" : "OK");
process.exit(fatal ? 1 : 0);
