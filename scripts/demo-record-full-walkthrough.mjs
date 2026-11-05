#!/usr/bin/env node
/**
 * Full investor/YC demo recording:
 * marketing site → sign-in → console tabs → faucet attempt → policies →
 * playground HITL → approve → work.
 *
 * Prerequisites: local `npm run dev`, account in /tmp/abi-full-demo-creds.json
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
  await pause(1100);
}

async function clickTab(page, label) {
  const tab = page.getByRole("tab", { name: new RegExp(`^${label}$`, "i") }).first();
  if ((await tab.count()) > 0) {
    await tab.click();
  } else {
    const soft = page.getByRole("tab", { name: new RegExp(label, "i") }).first();
    if ((await soft.count()) > 0) await soft.click();
    else await page.getByText(label, { exact: true }).first().click();
  }
  await pause(900);
}

async function shot(page, name) {
  const path = resolve(OUT, name);
  await page.screenshot({ path, fullPage: false });
  console.log("shot", name);
}

async function scrollTour(page, tops = [500, 1100, 1800, 0]) {
  for (const top of tops) {
    await page.evaluate((y) => window.scrollTo({ top: y, behavior: "smooth" }), top).catch(() => {});
    await pause(900);
  }
}

const browser = await chromium.launch({
  headless: true,
  slowMo: 60,
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
  // -------- Marketing tour --------
  step("Home");
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await pause(2500);
  await scrollTour(page, [700, 1400, 2200, 0]);
  await shot(page, "full-01-home.png");

  for (const [path, file] of [
    ["/docs", "full-02-docs.png"],
    ["/pricing", "full-03-pricing.png"],
    ["/partnerships", "full-04-partnerships.png"],
    ["/about", "full-05-about.png"],
    ["/waitlist", "full-06-waitlist.png"],
    ["/directory", "full-07-directory.png"],
    ["/terms", "full-08-terms.png"],
    ["/privacy", "full-09-privacy.png"],
  ]) {
    step(`Marketing ${path}`);
    await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
    await pause(1500);
    await scrollTour(page, [450, 900, 0]);
    await shot(page, file);
  }

  // -------- Sign in --------
  step("Console sign-in");
  await page.goto(`${BASE}/console`, { waitUntil: "domcontentloaded" });
  await pause(1400);
  await page.getByRole("tab", { name: /Sign in/i }).click().catch(() => {});
  await pause(500);
  await page.getByPlaceholder("you@company.com").fill(creds.email);
  await page.locator('input[type="password"]').first().fill(creds.password);
  await shot(page, "full-10-signin.png");
  await page.getByRole("button", { name: /^Sign in$/i }).click();
  await page.getByText("Maya Research Desk", { timeout: 45000 }).waitFor();
  await pause(2200);
  await shot(page, "full-11-overview.png");

  // Dismiss tips / onboarding if present
  for (const re of [/got it/i, /dismiss/i, /close/i, /skip/i]) {
    await page.getByRole("button", { name: re }).first().click({ timeout: 800 }).catch(() => {});
  }
  await pause(400);

  // -------- Insights all tabs --------
  step("Insights tabs");
  await clickNav(page, "Insights");
  await pause(1000);
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

  // -------- Treasury + faucet --------
  step("Treasury Fund + faucet");
  await clickNav(page, "Treasury");
  await clickTab(page, "Fund").catch(() => {});
  await pause(1400);
  await shot(page, "full-17-treasury-fund.png");

  // Copy vault address if button exists
  const copyBtn = page.getByRole("button", { name: /copy/i }).first();
  if ((await copyBtn.count()) > 0) await copyBtn.click().catch(() => {});
  await pause(700);

  // Circle USDC faucet (captcha often blocks submit — still show address + network)
  const faucet = await context.newPage();
  step("Circle faucet page");
  await faucet
    .goto("https://faucet.circle.com/", { waitUntil: "domcontentloaded", timeout: 90000 })
    .catch((e) => step(`Circle navigate warn: ${e.message}`));
  await pause(2800);
  await faucet.screenshot({ path: resolve(OUT, "full-18-circle-faucet.png") }).catch(() => {});

  // USDC + Base Sepolia
  await faucet.getByText(/^USDC$/i).first().click({ timeout: 4000 }).catch(() => {});
  await pause(500);
  await faucet.getByText(/Base Sepolia/i).first().click({ timeout: 5000 }).catch(() => {});
  await pause(700);
  // Network combobox / listbox if present
  const net = faucet.getByLabel(/Network/i).first();
  if ((await net.count()) > 0) {
    await net.click().catch(() => {});
    await pause(400);
    await faucet.getByText(/Base Sepolia/i).first().click().catch(() => {});
    await pause(600);
  }

  if (creds.vaultAddress) {
    const addr = faucet
      .getByPlaceholder(/Wallet address/i)
      .or(faucet.getByLabel(/Send to/i))
      .or(faucet.locator('input[placeholder*="address" i]'))
      .first();
    await addr.waitFor({ timeout: 8000 }).catch(() => {});
    await addr.click({ clickCount: 3 }).catch(() => {});
    await addr.fill(creds.vaultAddress).catch(async () => {
      await faucet.locator("input:visible").last().fill(creds.vaultAddress).catch(() => {});
    });
    await pause(1000);
    // Verify fill
    const val = await addr.inputValue().catch(() => "");
    step(`Faucet address filled: ${val.slice(0, 12)}… (${val.length} chars)`);
  }
  await faucet.screenshot({ path: resolve(OUT, "full-19-faucet-address.png") }).catch(() => {});
  await faucet
    .getByRole("button", { name: /Send 20 USDC|send|request|get|claim|continue|submit/i })
    .first()
    .click({ timeout: 4000 })
    .catch(() => {});
  await pause(2500);
  await faucet.screenshot({ path: resolve(OUT, "full-19b-faucet-submit.png") }).catch(() => {});
  await faucet.close().catch(() => {});

  // Alchemy Base Sepolia ETH faucet (gas)
  const ethFaucet = await context.newPage();
  step("Alchemy Base Sepolia faucet");
  await ethFaucet
    .goto("https://www.alchemy.com/faucets/base-sepolia", {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    })
    .catch((e) => step(`Alchemy navigate warn: ${e.message}`));
  await pause(2500);
  if (creds.vaultAddress) {
    await ethFaucet.locator("input:visible").first().fill(creds.vaultAddress).catch(() => {});
    await pause(800);
  }
  await ethFaucet.screenshot({ path: resolve(OUT, "full-20-alchemy-faucet.png") }).catch(() => {});
  await ethFaucet
    .getByRole("button", { name: /send me|request|claim|continue/i })
    .first()
    .click({ timeout: 3000 })
    .catch(() => {});
  await pause(1500);
  await ethFaucet.close().catch(() => {});

  // Back to treasury — Sync deposits + show vault funded state (demo ledger float)
  await page.bringToFront();
  await clickNav(page, "Treasury");
  await clickTab(page, "Fund").catch(() => {});
  const sync = page.getByRole("button", { name: /sync/i }).first();
  if ((await sync.count()) > 0) {
    await sync.click().catch(() => {});
    await pause(2000);
  }
  await pause(1200);
  await shot(page, "full-21-treasury-after-sync.png");

  for (const tab of ["Budgets", "Move", "Analytics"]) {
    await clickTab(page, tab).catch(() => {});
    await pause(800);
  }
  await shot(page, "full-22-treasury-budgets.png");

  // -------- Transactions (skip Batch + Rails) --------
  step("Transactions tabs");
  await clickNav(page, "Transactions");
  await pause(1000);
  await shot(page, "full-23-tx-approvals.png");
  for (const [tab, file] of [
    ["Recent", "full-24-tx-recent.png"],
    ["Invoices", "full-25-tx-invoices.png"],
    ["Escrows", "full-26-tx-escrows.png"],
    ["Scheduled", "full-27-tx-scheduled.png"],
  ]) {
    await clickTab(page, tab).catch(async () => {
      await page.getByText(tab, { exact: true }).first().click().catch(() => {});
    });
    await shot(page, file);
  }

  // -------- Policies: lower Ask-me-above slightly, save --------
  step("Policies adjust");
  await clickNav(page, "Policies");
  await clickTab(page, "Limits").catch(() => {});
  await pause(1200);
  await shot(page, "full-28-policies-before.png");

  const hitl = page.locator("#band-hitl");
  if ((await hitl.count()) > 0) {
    await hitl.click({ clickCount: 3 });
    await hitl.fill("8");
    await hitl.blur().catch(() => {});
  } else {
    const askField = page.getByLabel(/ask me above/i).first();
    if ((await askField.count()) > 0) await askField.fill("8");
  }
  await pause(700);

  await clickTab(page, "Allowlists").catch(() => {});
  await pause(900);
  await shot(page, "full-29-policies-allowlists.png");
  await clickTab(page, "Limits").catch(() => {});
  await pause(600);

  const save = page.getByRole("button", { name: /save policy/i }).first();
  if ((await save.count()) > 0) {
    const enabled = await save.isEnabled().catch(() => false);
    if (enabled) {
      await save.click();
      await pause(1500);
    }
  }
  await shot(page, "full-30-policies-after.png");

  // -------- Playground HITL --------
  step("Playground large purchase");
  await clickNav(page, "Playground");
  await pause(1800);

  // Paste Researcher agent key (required before Run enables)
  if (creds.agentApiKey) {
    const keyBox = page.getByLabel(/Agent key/i).or(page.getByPlaceholder(/pv_agent/i)).first();
    await keyBox.waitFor({ timeout: 10000 }).catch(() => {});
    if ((await keyBox.count()) > 0) {
      await keyBox.fill(creds.agentApiKey);
      await pause(400);
      await page.getByRole("button", { name: /^Add$/i }).click();
      await pause(1500);
      // Confirm acting agent appeared
      await page.getByText(/Researcher|Acting agent|Headroom today/i).first().waitFor({ timeout: 15000 }).catch(() => {});
    }
  }
  await pause(600);

  // Guided scenarios → Large purchase (must be the active briefing before Run)
  await page.getByRole("tab", { name: /Guided scenarios|scenarios/i }).first().click().catch(() => {});
  await pause(400);
  // Scroll scenario list and click the card by exact title
  const scenarioCard = page
    .locator(".scenario-card")
    .filter({ hasText: /Large purchase \(needs your approval\)/i })
    .first();
  await scenarioCard.scrollIntoViewIfNeeded().catch(() => {});
  await pause(400);
  await scenarioCard.click();
  await pause(900);

  // Confirm briefing title switched
  const briefingTitle = page.locator(".lab-briefing-title h2, .lab-briefing h2").first();
  await briefingTitle.scrollIntoViewIfNeeded().catch(() => {});
  for (let i = 0; i < 10; i++) {
    const t = ((await briefingTitle.innerText().catch(() => "")) || "").trim();
    if (/Large purchase/i.test(t)) break;
    await scenarioCard.click().catch(() => {});
    await pause(500);
  }
  const confirmed = ((await briefingTitle.innerText().catch(() => "")) || "").trim();
  if (!/Large purchase/i.test(confirmed)) {
    throw new Error(`Expected Large purchase briefing, got: ${confirmed || "(empty)"}`);
  }
  step(`Scenario locked: ${confirmed}`);

  await page.getByTestId("run-button").scrollIntoViewIfNeeded().catch(() => {});
  await pause(800);
  await shot(page, "full-31-playground-scenario.png");

  const disabledReason = page.getByTestId("run-disabled-reason");
  if ((await disabledReason.count()) > 0) {
    const why = await disabledReason.innerText().catch(() => "");
    step(`Run still disabled: ${why}`);
  }

  const runBtn = page.getByTestId("run-button");
  await runBtn.waitFor({ state: "visible", timeout: 10000 });
  for (let i = 0; i < 20; i++) {
    if (await runBtn.isEnabled().catch(() => false)) break;
    await pause(500);
  }
  if (!(await runBtn.isEnabled())) {
    throw new Error(
      `Playground Run stayed disabled (${(await disabledReason.innerText().catch(() => "no reason"))})`,
    );
  }
  await runBtn.click();
  step("Waiting for park / approval");
  // Prefer the in-app Approval needed toast / parked step
  await page
    .getByText(/Approval needed|waiting for your decision|PARK|Amount requires human approval/i)
    .first()
    .waitFor({ timeout: 60000 });
  await pause(1800);
  await shot(page, "full-32-playground-parked.png");

  // -------- Approvals --------
  step("Approve payment");
  // Prefer in-app Review toast if still visible
  await page.getByRole("button", { name: /Review/i }).first().click({ timeout: 4000 }).catch(() => {});
  await pause(800);
  await clickNav(page, "Approvals");
  await pause(2000);
  // Wait for pending card / approve CTA (poll refresh)
  let approve = page.getByRole("button", { name: /Approve payment/i }).first();
  for (let i = 0; i < 12 && (await approve.count()) === 0; i++) {
    await pause(1000);
    // soft reload view by re-clicking nav
    if (i === 4 || i === 8) await clickNav(page, "Approvals");
    approve = page.getByRole("button", { name: /Approve payment/i }).first();
  }
  await shot(page, "full-33-approvals-pending.png");
  if ((await approve.count()) > 0) {
    await approve.click();
    await pause(4500);
  } else {
    const alt = page.getByRole("button", { name: /^Approve$/i }).first();
    if ((await alt.count()) === 0) {
      throw new Error("No Approve payment button on Approvals after park");
    }
    await alt.click();
    await pause(4500);
  }
  await shot(page, "full-34-approvals-done.png");

  // Let playground finish / deliverable land
  await clickNav(page, "Playground");
  await pause(2000);
  // If navigation interrupted the live run UI, resume / open deliverable
  await page.getByRole("button", { name: /^Resume$/i }).first().click({ timeout: 3000 }).catch(() => {});
  await pause(1500);
  await page
    .getByText(/Purchase decision record|deliverable|Open deliverable|complete|settled/i)
    .first()
    .waitFor({ timeout: 45000 })
    .catch(() => {});
  await pause(1500);
  await page.getByRole("button", { name: /Open deliverable/i }).first().click({ timeout: 3000 }).catch(() => {});
  await pause(1200);
  await shot(page, "full-34b-playground-after-approve.png");

  // Recent transactions
  await clickNav(page, "Transactions");
  await clickTab(page, "Recent").catch(() => {});
  await pause(1400);
  await shot(page, "full-35-tx-recent-after.png");

  // -------- Work --------
  step("Work");
  await clickNav(page, "Work");
  await pause(2000);
  // Archive cards are button.mission-card — pick completed Large purchase with spend
  const largeDone = page
    .locator("button.mission-card")
    .filter({ hasText: /Large purchase \(needs your approval\)/i })
    .filter({ hasText: /complete/i })
    .filter({ hasText: /\$15/i })
    .first();
  if ((await largeDone.count()) > 0) {
    await largeDone.click();
  } else {
    await page
      .locator("button.mission-card")
      .filter({ hasText: /Large purchase/i })
      .filter({ hasText: /complete/i })
      .first()
      .click()
      .catch(() => {});
  }
  await pause(1800);
  await shot(page, "full-36-work.png");
  await page
    .getByText(/Purchase decision record|Approved\.|Bill this work|Markdown/i)
    .first()
    .waitFor({ timeout: 20000 })
    .catch(() => {});
  await pause(1000);
  const bill = page.getByRole("button", { name: /Bill this work/i }).first();
  if ((await bill.count()) > 0 && (await bill.isEnabled().catch(() => false))) {
    await bill.click().catch(() => {});
    await pause(2500);
  }
  await shot(page, "full-37-work-detail.png");

  // -------- Closing overview --------
  step("Overview close");
  await clickNav(page, "Overview");
  await pause(2000);
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
    [
      "-y",
      "-i",
      destWebm,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      mp4,
    ],
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
