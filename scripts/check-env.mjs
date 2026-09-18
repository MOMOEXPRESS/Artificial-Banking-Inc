#!/usr/bin/env node
/**
 * Environment preflight for a deployment.
 *
 * Most "the console is broken" reports are a missing or wrong environment
 * variable, and the symptom is always somewhere else: the API refuses to boot,
 * or answers 503, or sign-in succeeds and the session evaporates on the next
 * request. This checks the variables each process actually reads, names the
 * consequence of each problem, and exits non-zero when something is fatal — so
 * it can gate a deploy.
 *
 * Usage:
 *   node scripts/check-env.mjs --role api           # the Express API service
 *   node scripts/check-env.mjs --role console       # the Next.js console
 *   node scripts/check-env.mjs --role both
 *   node --env-file=.env scripts/check-env.mjs --role both
 *   node scripts/check-env.mjs --generate           # fresh secrets to paste
 *
 * Add --production to apply the production rules to a non-production shell
 * (the checker infers them from NODE_ENV otherwise).
 */
import { randomBytes } from "node:crypto";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const DEV_PEPPER = "abi-dev-pepper-change-me";
const role = value("role", "both");
const production = flag("production") || process.env.NODE_ENV === "production";

if (!["api", "console", "both"].includes(role)) {
  console.error(`Unknown --role "${role}". Use api, console, or both.`);
  process.exit(2);
}

const secret = () => randomBytes(32).toString("base64");

if (flag("generate")) {
  console.log(`
Fresh secrets. Set each ONCE, then keep it — these are not rotatable for free.

  ABI_KEK=${secret()}
  ABI_KEY_PEPPER=${secret()}
  ABI_SIGNUP_TOKEN=${secret()}

  ABI_KEK          encrypts vault private keys at rest. Lose it and every vault
                   key is unrecoverable. Change it on a running deployment and
                   existing keys stop decrypting.
  ABI_KEY_PEPPER   salts API-key hashes. Changing it invalidates every issued
                   guardian and agent key.
  ABI_SIGNUP_TOKEN gates org creation and demo seeding. Set the SAME value on
                   the API service and on the console project.
`);
  process.exit(0);
}

const findings = [];
const ok = (scope, name, detail) => findings.push({ level: "ok", scope, name, detail });
const warn = (scope, name, detail, fix) =>
  findings.push({ level: "warn", scope, name, detail, fix });
const fail = (scope, name, detail, fix) =>
  findings.push({ level: "fail", scope, name, detail, fix });

const read = (name) => process.env[name]?.trim() ?? "";

function isHttpUrl(raw) {
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- API service

function checkApi() {
  const scope = "api";

  const kek = read("ABI_KEK");
  if (!kek) {
    (production ? fail : warn)(
      scope,
      "ABI_KEK",
      production
        ? "unset — every vault operation throws in production (the API still boots, so this surfaces as a 500 the first time an agent pays)"
        : "unset — the public development key is in use; fatal in production",
      "node scripts/check-env.mjs --generate — then back the value up somewhere you cannot lose it",
    );
  } else if (kek === "abi-dev-kek-not-for-production") {
    fail(
      scope,
      "ABI_KEK",
      "set to the development value published in this repository",
      "node scripts/check-env.mjs --generate",
    );
  } else if (kek.length < 16) {
    warn(
      scope,
      "ABI_KEK",
      "shorter than 16 characters — any string works, but this one is guessable",
      "use the value from --generate",
    );
  } else {
    ok(scope, "ABI_KEK", "set");
  }

  const pepper = read("ABI_KEY_PEPPER") || read("POLICYVAULT_KEY_PEPPER");
  if (!pepper) {
    (production ? fail : warn)(
      scope,
      "ABI_KEY_PEPPER",
      production
        ? "unset — session tokens are hashed with it, so in production EVERY successful sign-in fails (and, before the async-route fix, took the process down)"
        : "unset — the public development value is in use",
      "node scripts/check-env.mjs --generate",
    );
  } else if (pepper === DEV_PEPPER) {
    fail(
      scope,
      "ABI_KEY_PEPPER",
      "set to the development value, which is published in this repository",
      "node scripts/check-env.mjs --generate",
    );
  } else {
    ok(scope, "ABI_KEY_PEPPER", "set");
  }

  const signup = read("ABI_SIGNUP_TOKEN");
  if (!signup) {
    (production ? fail : warn)(
      scope,
      "ABI_SIGNUP_TOKEN",
      production
        ? "unset — org creation and demo seeding refuse to serve in production"
        : "unset — those routes are open, which is only acceptable locally",
      "node scripts/check-env.mjs --generate, and set the same value on the console project",
    );
  } else {
    ok(scope, "ABI_SIGNUP_TOKEN", "set (must match the console's value)");
  }

  const db = read("POLICYVAULT_DB");
  if (!db) {
    (production ? fail : warn)(
      scope,
      "POLICYVAULT_DB",
      "unset — the database lands in the container filesystem and every deploy resets it",
      "point it at a mounted disk, e.g. /data/policyvault.db (render.yaml mounts /data)",
    );
  } else if (production && (db.startsWith("./") || db.startsWith("/tmp"))) {
    fail(
      scope,
      "POLICYVAULT_DB",
      `"${db}" is not a persistent disk — orgs, keys and the ledger vanish on redeploy`,
      "use a path under the mounted volume, e.g. /data/policyvault.db",
    );
  } else {
    ok(scope, "POLICYVAULT_DB", db);
  }

  const consoleUrl = read("ABI_CONSOLE_URL");
  if (!consoleUrl) {
    warn(
      scope,
      "ABI_CONSOLE_URL",
      "unset — password-reset links point at http://localhost:3000",
      "set it to the console's public URL",
    );
  } else if (!isHttpUrl(consoleUrl)) {
    fail(
      scope,
      "ABI_CONSOLE_URL",
      `"${consoleUrl}" is not an absolute URL`,
      "e.g. https://console.example.com",
    );
  } else {
    ok(scope, "ABI_CONSOLE_URL", consoleUrl);
  }

  const cors = read("ABI_CORS_ORIGINS");
  if (!cors) {
    ok(scope, "ABI_CORS_ORIGINS", "empty — correct when the console proxies through /abi-api");
  } else if (cors.includes("*")) {
    fail(
      scope,
      "ABI_CORS_ORIGINS",
      "contains a wildcard — browsers refuse wildcard origins on credentialed requests, so sign-in fails",
      "list exact origins, e.g. https://console.example.com",
    );
  } else {
    const bad = cors
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s && !isHttpUrl(s));
    if (bad.length) {
      fail(
        scope,
        "ABI_CORS_ORIGINS",
        `not absolute origins: ${bad.join(", ")}`,
        "use scheme + host, no path",
      );
    } else {
      ok(scope, "ABI_CORS_ORIGINS", cors);
    }
  }

  /**
   * All three read "1" as on and fall back to `NODE_ENV !== "production"`, so
   * production is already closed when they are unset. Only an explicit "1" is
   * dangerous there; in development it is the unset default that is open.
   */
  for (const [name, why] of [
    ["POLICYVAULT_ALLOW_BOOTSTRAP", "demo seeding hands out a root guardian key"],
    ["POLICYVAULT_ALLOW_PUBLIC_ORG_CREATE", "anonymous org creation hands out a root guardian key"],
    [
      "ABI_ALLOW_LOCAL_TARGETS",
      "an agent-supplied destination can probe the host's internal network",
    ],
  ]) {
    const raw = read(name);
    if (raw === "1") {
      (production ? fail : warn)(scope, name, `"1" — ${why}`, `set ${name}=0`);
    } else if (raw === "0") {
      ok(scope, name, "0 (closed)");
    } else if (production) {
      ok(scope, name, "unset — closed, because NODE_ENV is production");
    } else {
      warn(
        scope,
        name,
        `unset — open outside production, and ${why}`,
        `set ${name}=0 on anything others can reach`,
      );
    }
  }

  if (!read("CHAIN_RPC_URL")) {
    warn(
      scope,
      "CHAIN_RPC_URL",
      "unset — the public RPC rate-limits and drops log ranges, so deposit detection misses transfers",
      "set a paid Base endpoint (Alchemy/Infura/QuickNode)",
    );
  } else {
    ok(scope, "CHAIN_RPC_URL", "set");
  }

  const runJobs = read("ABI_RUN_JOBS");
  if (runJobs && !["0", "1"].includes(runJobs)) {
    warn(
      scope,
      "ABI_RUN_JOBS",
      `"${runJobs}" — anything other than "0" runs the sweeps`,
      "set 1 here, or 0 when apps/worker runs them",
    );
  } else {
    ok(scope, "ABI_RUN_JOBS", runJobs || "unset (defaults to running the sweeps)");
  }
}

// ------------------------------------------------------------- Next.js console

function checkConsole() {
  const scope = "console";

  const origin = read("ABI_API_ORIGIN") || read("POLICYVAULT_API_URL");
  if (!origin) {
    fail(
      scope,
      "ABI_API_ORIGIN",
      "unset — /abi-api answers 503 API_NOT_CONFIGURED and nobody can sign in",
      "set it to the API service URL, e.g. https://abi-api.onrender.com (no trailing slash, no /v1)",
    );
  } else if (!isHttpUrl(origin)) {
    fail(
      scope,
      "ABI_API_ORIGIN",
      `"${origin}" is not an absolute URL`,
      "include the scheme: https://…",
    );
  } else if (/\/v1\/?$/.test(origin)) {
    fail(
      scope,
      "ABI_API_ORIGIN",
      `"${origin}" ends in /v1 — the proxy appends the full path, so every call 404s`,
      "drop the /v1 suffix",
    );
  } else if (origin.endsWith("/")) {
    warn(
      scope,
      "ABI_API_ORIGIN",
      "has a trailing slash",
      "the proxy strips it, but drop it anyway",
    );
  } else {
    ok(scope, "ABI_API_ORIGIN", origin);
  }

  /**
   * The one that silently breaks sign-in: pointed straight at the API, the
   * browser's login POST is cross-site, and a SameSite=Lax session cookie is
   * not stored — so login returns 200 and the very next request is a 401.
   */
  const publicUrl = read("NEXT_PUBLIC_API_URL");
  if (!publicUrl || publicUrl === "/abi-api") {
    ok(scope, "NEXT_PUBLIC_API_URL", publicUrl || "unset (defaults to /abi-api)");
  } else if (isHttpUrl(publicUrl)) {
    fail(
      scope,
      "NEXT_PUBLIC_API_URL",
      `"${publicUrl}" makes the browser call the API cross-site; the SameSite=Lax session cookie is dropped, so sign-in appears to work and the next request is 401`,
      "set NEXT_PUBLIC_API_URL=/abi-api and let the server-side proxy forward",
    );
  } else {
    ok(scope, "NEXT_PUBLIC_API_URL", publicUrl);
  }

  if (!read("ABI_SIGNUP_TOKEN")) {
    warn(
      scope,
      "ABI_SIGNUP_TOKEN",
      "unset — the proxy cannot attach it, so creating an organization fails with 'Missing or invalid x-abi-signup-token'",
      "set the same value as on the API service (server-side only, never NEXT_PUBLIC_)",
    );
  } else {
    ok(scope, "ABI_SIGNUP_TOKEN", "set (must match the API's value)");
  }

  for (const name of Object.keys(process.env)) {
    if (name.startsWith("NEXT_PUBLIC_") && /KEK|PEPPER|SIGNUP_TOKEN|SECRET|PRIVATE/i.test(name)) {
      fail(
        scope,
        name,
        "a secret is exposed to the browser under a NEXT_PUBLIC_ name",
        `remove ${name} and use the server-side variable`,
      );
    }
  }
}

if (role === "api" || role === "both") checkApi();
if (role === "console" || role === "both") checkConsole();

const MARK = { ok: "  ok  ", warn: " warn ", fail: " FAIL " };
let lastScope = "";
for (const f of findings) {
  if (f.scope !== lastScope) {
    console.log(
      `\n${f.scope === "api" ? "API service" : "Console (Next.js)"} — ${production ? "production" : "development"} rules`,
    );
    lastScope = f.scope;
  }
  console.log(`[${MARK[f.level]}] ${f.name}: ${f.detail}`);
  if (f.fix) console.log(`           → ${f.fix}`);
}

const fails = findings.filter((f) => f.level === "fail").length;
const warns = findings.filter((f) => f.level === "warn").length;
console.log(
  `\n${findings.length - fails - warns} ok, ${warns} warning${warns === 1 ? "" : "s"}, ${fails} blocking.`,
);
if (fails) {
  console.log("Fix the blocking items before deploying — each one breaks a user-visible path.\n");
}
process.exit(fails ? 1 : 0);
