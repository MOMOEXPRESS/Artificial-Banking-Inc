#!/usr/bin/env node
/**
 * Classify login-path failures for a hosted (or local) ABI console.
 *
 * Usage:
 *   node scripts/check-login-api.mjs https://your-console.vercel.app
 *   node scripts/check-login-api.mjs http://127.0.0.1:3000
 *
 * Exit 0 = health + login endpoint are reachable (401 on dummy creds is success).
 * Exit 1 = the console or API is misconfigured; the printed diagnosis says what to set.
 */
const target = (process.argv[2] ?? "https://artificial-banking-inc-gaia10.vercel.app").replace(
  /\/$/,
  "",
);

function header(res, name) {
  return res.headers.get(name) ?? res.headers.get(name.toLowerCase()) ?? "";
}

async function probe(path, init = {}) {
  const url = `${target}${path}`;
  const started = Date.now();
  try {
    const res = await fetch(url, { redirect: "manual", ...init });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return {
      url,
      ok: res.ok,
      status: res.status,
      ms: Date.now() - started,
      vercelError: header(res, "x-vercel-error"),
      location: header(res, "location"),
      contentType: header(res, "content-type"),
      setCookie: typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [],
      json,
      text: text.slice(0, 400),
    };
  } catch (e) {
    return {
      url,
      ok: false,
      status: 0,
      ms: Date.now() - started,
      vercelError: "",
      location: "",
      contentType: "",
      setCookie: [],
      json: null,
      text: e instanceof Error ? e.message : String(e),
      networkError: true,
    };
  }
}

function line(label, value) {
  console.log(`${label.padEnd(18)} ${value}`);
}

const diagnoses = [];

const root = await probe("/");
const health = await probe("/abi-api/health");
const login = await probe("/abi-api/v1/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "probe@example.com", password: "not-the-password-xx" }),
});
const badEmail = await probe("/abi-api/v1/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "not-an-email", password: "x" }),
});

console.log(`Login API probe  ${new Date().toISOString()}`);
console.log(`Target           ${target}\n`);
line("GET /", `${root.status} ${root.vercelError || root.contentType}`.trim());
line("GET /abi-api/health", `${health.status} ${JSON.stringify(health.json ?? health.text.slice(0, 120))}`);
line(
  "POST /v1/auth/login",
  `${login.status} ${JSON.stringify(login.json ?? login.text.slice(0, 120))}`,
);
line(
  "POST login (bad email)",
  `${badEmail.status} ${JSON.stringify(badEmail.json ?? badEmail.text.slice(0, 120))}`,
);

if (root.networkError) {
  diagnoses.push("Could not reach the host at all (DNS, TLS, or network).");
} else if (root.vercelError === "DEPLOYMENT_NOT_FOUND" || root.vercelError === "NOT_FOUND") {
  diagnoses.push(
    `Vercel has no live deployment (${root.vercelError}). The console URL is dead — login cannot work until you redeploy.`,
  );
  diagnoses.push(
    "Fix: Vercel → team → project artificial-banking-inc → Deployments → Redeploy the Production branch (main), Root Directory = apps/web.",
  );
  diagnoses.push(
    "Wrong hostnames stay 404 forever: artificial-banking-inc.vercel.app on a team project. Use the Domains URL Vercel shows.",
  );
} else if (root.status === 401 && /vercel\.com\/login/.test(root.location)) {
  diagnoses.push(
    "Deployment Protection SSO is on. Visitors hit vercel.com/login, not the console. Turn it off (Settings → Deployment Protection) or run VERCEL_TOKEN=… npm run vercel:harden",
  );
} else if (health.status === 503 && health.json?.error?.code === "API_NOT_CONFIGURED") {
  diagnoses.push(
    "Console is up, but ABI_API_ORIGIN is unset on Vercel. The /abi-api proxy has nowhere to send login.",
  );
  diagnoses.push(
    "Fix: deploy the API (Render blueprint / render.yaml), set ABI_API_ORIGIN=https://your-api.onrender.com on Vercel, set the same ABI_SIGNUP_TOKEN on both, then Redeploy.",
  );
} else if (health.status === 502 || login.json?.error?.code === "API_UNREACHABLE") {
  diagnoses.push(
    `Console is up, ABI_API_ORIGIN is set, but the API is unreachable: ${login.json?.error?.message ?? health.text}`,
  );
  diagnoses.push("Fix: start/redeploy the API service. Confirm curl $ABI_API_ORIGIN/health returns JSON.");
} else if (health.status === 200 && login.status === 401 && login.json?.error?.code === "UNAUTHORIZED") {
  diagnoses.push(
    "Login endpoint is healthy. 401 on dummy credentials is expected (wrong email/password).",
  );
  if (badEmail.status !== 400) {
    diagnoses.push(
      `Malformed-email login returned ${badEmail.status} instead of JSON 400 — auth error handling is not reaching the Zod handler.`,
    );
  }
} else if (login.status === 401 && login.json?.error?.message?.includes("x-abi-signup-token")) {
  diagnoses.push(
    "Login/org-create is gated by ABI_SIGNUP_TOKEN and the console proxy is not attaching it. Set the SAME value on Vercel and the API, then redeploy both.",
  );
} else if (![200, 401, 400].includes(login.status)) {
  diagnoses.push(
    `Unexpected login status ${login.status}. Body: ${login.text.slice(0, 200)}`,
  );
}

if (login.status === 200 && login.json?.user) {
  diagnoses.push(
    "Dummy credentials were accepted — public signup/login is wide open or the probe email already exists with that password. Rotate ABI_SIGNUP_TOKEN and review POLICYVAULT_ALLOW_PUBLIC_ORG_CREATE.",
  );
}

console.log("\nDiagnosis");
for (const d of diagnoses) console.log(`  • ${d}`);

const healthyLogin =
  health.status === 200 &&
  login.status === 401 &&
  login.json?.error?.code === "UNAUTHORIZED";
process.exit(healthyLogin ? 0 : 1);
