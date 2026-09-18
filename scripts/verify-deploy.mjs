#!/usr/bin/env node
/**
 * Post-deploy verification for the sign-in path.
 *
 * Point it at whichever URL you hand to users — the console or the API — and it
 * exercises the path a browser takes, reporting the specific misconfiguration
 * behind each failure rather than "login is broken".
 *
 * Usage:
 *   node scripts/verify-deploy.mjs https://your-console.vercel.app
 *   node scripts/verify-deploy.mjs https://abi-api.onrender.com
 *   node scripts/verify-deploy.mjs https://your-console.vercel.app \
 *     --email you@example.com --password '…'      # full round trip
 *
 * The credential flags are optional. Without them the check stops short of a
 * real session, which still catches every configuration fault; with them it
 * also proves the session cookie survives the proxy.
 */
const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith("--"));
const value = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const target = positional[0];
if (!target) {
  console.error(
    "Usage: node scripts/verify-deploy.mjs <console-or-api-url> [--email … --password …]",
  );
  process.exit(2);
}

const email = value("email");
const password = value("password");
const root = target.replace(/\/+$/, "");
const TIMEOUT_MS = Number(value("timeout") ?? 15000);

let failures = 0;
let warnings = 0;

const pass = (name, detail) => console.log(`[  ok  ] ${name}${detail ? `: ${detail}` : ""}`);
const warn = (name, detail, fix) => {
  warnings++;
  console.log(`[ warn ] ${name}: ${detail}`);
  if (fix) console.log(`         → ${fix}`);
};
const fail = (name, detail, fix) => {
  failures++;
  console.log(`[ FAIL ] ${name}: ${detail}`);
  if (fix) console.log(`         → ${fix}`);
};

async function req(url, init = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, redirect: "manual" });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { res, text, json };
  } finally {
    clearTimeout(timer);
  }
}

/** Is this the API itself, or a console proxying to one? */
async function resolveApiBase() {
  for (const base of [root, `${root}/abi-api`]) {
    try {
      const { res, json } = await req(`${base}/health`);
      if (res.ok && json?.service === "abi-api") {
        pass("health", `${base}/health → ok, up ${json.uptimeSec}s`);
        return base;
      }
      if (json?.error?.code === "API_NOT_CONFIGURED") {
        fail(
          "console proxy",
          "the console has no ABI_API_ORIGIN, so every sign-in returns 503",
          "Vercel → Settings → Environment Variables → ABI_API_ORIGIN=https://your-api…, then redeploy",
        );
        return null;
      }
      if (json?.error?.code === "API_UNREACHABLE") {
        fail(
          "console proxy",
          `ABI_API_ORIGIN is set but the API did not answer: ${json.error.message}`,
          "check the API service is running and the URL has no typo, no trailing slash and no /v1",
        );
        return null;
      }
    } catch (e) {
      if (base === `${root}/abi-api`) {
        fail(
          "health",
          `${base}/health did not respond (${e.name}: ${e.message})`,
          "is the URL right, and the service awake?",
        );
      }
    }
  }
  if (!failures)
    fail("health", `neither ${root}/health nor ${root}/abi-api/health identified an ABI API`);
  return null;
}

const api = await resolveApiBase();
if (!api) {
  console.log(`\n${failures} blocking, ${warnings} warnings.`);
  process.exit(1);
}

const jsonPost = (body) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: typeof body === "string" ? body : JSON.stringify(body),
});

/** One check must not abort the rest: a target that died is exactly what we are here to find. */
async function check(name, fn) {
  try {
    await fn();
  } catch (e) {
    fail(
      name,
      `check could not complete (${e.name}: ${e.message})`,
      "the service stopped responding",
    );
  }
}

/**
 * A malformed body used to hang and then kill the API process. A deployment
 * still doing that answers nothing at all here, which is the clearest signal
 * that the running build predates the fix.
 */
{
  const name = "malformed login body";
  try {
    const { res, json } = await req(`${api}/v1/auth/login`, jsonPost({ email: "nope" }));
    if (res.status === 400 && json?.error?.code === "VALIDATION_ERROR") {
      pass(name, "400 VALIDATION_ERROR");
    } else if (res.status >= 500) {
      fail(
        name,
        `answered ${res.status} — a client mistake is being reported as a server error`,
        "deploy the current build",
      );
    } else {
      warn(name, `answered ${res.status}, expected 400`);
    }
  } catch (e) {
    fail(
      name,
      `no response (${e.name}) — the process very likely died on the request`,
      "this deployment predates the async-route fix; redeploy from the current main",
    );
  }
}

await check("rejected credentials", async () => {
  const name = "rejected credentials";
  const { res, json } = await req(
    `${api}/v1/auth/login`,
    jsonPost({ email: `probe-${Date.now()}@example.invalid`, password: "not-a-real-password" }),
  );
  if (res.status === 401) {
    pass(name, "401");
    if (res.headers.getSetCookie?.().length) {
      fail(name, "a failed login still set a cookie", "this should never happen — report it");
    }
    if (json?.error?.message && /no account|not found|unknown user/i.test(json.error.message)) {
      warn(
        name,
        "the message distinguishes a missing account from a wrong password",
        "that turns the form into an account-existence oracle",
      );
    }
  } else if (res.status === 429) {
    warn(
      name,
      "429 — the rate limiter answered first",
      "re-run in a minute, or from another address",
    );
  } else {
    fail(name, `answered ${res.status}, expected 401`);
  }
});

if (email && password) {
  await check("sign-in round trip", async () => {
    const name = "sign-in round trip";
    const { res, json } = await req(`${api}/v1/auth/login`, jsonPost({ email, password }));
    if (res.status !== 200) {
      fail(name, `login answered ${res.status}: ${json?.error?.message ?? ""}`.trim());
      return;
    }

    const cookies = res.headers.getSetCookie?.() ?? [];
    const session = cookies.find((c) => c.startsWith("abi_session="));
    const csrf = cookies.find((c) => c.startsWith("abi_csrf="));

    if (!session) {
      fail(
        name,
        "200, but no abi_session cookie reached the client",
        "the proxy is collapsing Set-Cookie headers, or something in front strips them",
      );
      return;
    }

    pass(name, "200 with a session cookie");
    if (!/HttpOnly/i.test(session)) fail("session cookie", "not HttpOnly — script-readable");
    if (api.startsWith("https://") && !/Secure/i.test(session)) {
      fail(
        "session cookie",
        "not Secure on an HTTPS deployment",
        "the API must run with NODE_ENV=production",
      );
    }
    if (!/SameSite/i.test(session)) warn("session cookie", "no SameSite attribute");
    if (!csrf) warn("session cookie", "no abi_csrf cookie — console mutations will be refused");

    const jar = [session, csrf]
      .filter(Boolean)
      .map((c) => c.split(";")[0])
      .join("; ");
    const me = await req(`${api}/v1/auth/me`, { headers: { cookie: jar } });
    if (me.res.status === 200) {
      pass("session survives", `/v1/auth/me → 200 (${me.json?.user?.email ?? "?"})`);
    } else {
      fail(
        "session survives",
        `/v1/auth/me → ${me.res.status} with the cookie just issued`,
        "a session that dies immediately usually means the browser is talking to the API cross-site; set NEXT_PUBLIC_API_URL=/abi-api",
      );
    }
  });
} else {
  console.log("[ skip ] sign-in round trip: pass --email and --password to include it");
}

console.log(`\n${failures} blocking, ${warnings} warnings.`);
process.exit(failures ? 1 : 0);
