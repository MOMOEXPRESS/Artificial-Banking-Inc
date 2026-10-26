import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Give slow upstream calls (cold Durable Object, chain reads) room before
// Vercel kills the function; the fetch below aborts a little earlier so the
// console always gets a JSON error instead of a platform HTML page.
export const maxDuration = 60;
const UPSTREAM_TIMEOUT_MS = 55_000;

/**
 * Same-origin proxy to the ABI API.
 *
 * This route used to *embed* the API in-process on Vercel, running SQLite under
 * /tmp and synchronising the whole database through Vercel Runtime Cache on
 * every request. That was a read-modify-write cycle on a shared blob with no
 * compare-and-swap: concurrent requests each hydrated the same snapshot and
 * each persisted, so the loser's journals, payments and idempotency
 * reservations vanished *after* the caller had already received HTTP 200. It
 * also meant no background job ever ran, and a settlement slower than the
 * function timeout could move real USDC on-chain while discarding every write
 * that recorded it.
 *
 * See docs/adr/2026-07-26-persistent-api-over-serverless.md.
 *
 * The API is now a long-lived process. This file only forwards to it, and says
 * so plainly when it has not been told where that process lives — rather than
 * silently starting a lossy one.
 */
function resolveOrigin(): string | null {
  const candidates = [
    process.env.ABI_API_ORIGIN,
    process.env.POLICYVAULT_API_URL,
    process.env.NEXT_PUBLIC_API_URL,
  ];
  for (const raw of candidates) {
    if (!raw) continue;
    const trimmed = raw.trim().replace(/\/$/, "");
    if (!trimmed || trimmed === "/abi-api") continue;
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  }
  // Local development convenience: `npm run dev:api` listens here.
  if (!process.env.VERCEL) return "http://127.0.0.1:8787";
  return null;
}

/**
 * Routes that genuinely need the server-side signup token.
 *
 * Previously this also covered demo/status and guardian/orgs, which meant any
 * caller of the public console proxy could mint/root-bootstrap without knowing
 * the token — the token only gated direct API access. Keep the injection
 * narrow: self-serve signup, and demo bootstrap (still also gated by
 * POLICYVAULT_ALLOW_BOOTSTRAP on the API).
 */
const SIGNUP_PATHS = new Set(["v1/auth/signup", "v1/partner/auth/signup", "v1/demo/bootstrap"]);

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
]);

function notConfigured() {
  return NextResponse.json(
    {
      error: {
        code: "API_NOT_CONFIGURED",
        message:
          "This console has no API to talk to. The ABI API is a separate, long-lived " +
          "process — Vercel hosts the console, but cannot host the API. " +
          "Deploy the API Worker (apps/api-worker, `wrangler deploy --config ./wrangler.toml`), " +
          "then set ABI_API_ORIGIN on this Vercel project to its URL and redeploy. " +
          "Step-by-step: docs/DEPLOY.md.",
        /** Machine-readable so the console can render a setup card, not a toast. */
        setup: {
          missing: "ABI_API_ORIGIN",
          where: "Vercel → Settings → Environment Variables",
          example: "https://abi-api.<account>.workers.dev",
          docs: "docs/DEPLOY.md",
        },
      },
    },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

async function proxy(req: NextRequest, pathSegments: string[], origin: string) {
  const joined = pathSegments.map(encodeURIComponent).join("/");
  const incoming = new URL(req.url);
  const dest = `${origin}/${joined}${incoming.search}`;

  const headers = new Headers();
  req.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    // `host` must reflect the upstream, and hop-by-hop headers are per-connection.
    if (k === "host" || k === "content-length" || HOP_BY_HOP.has(k)) return;
    headers.set(key, value);
  });
  // Preserve the caller's address for the API's per-IP limits.
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) headers.set("x-forwarded-for", forwarded);

  // Attach the signup token for the routes that need it, and only those: a
  // token on every proxied request would end up in more logs than it needs to
  // be in. A client-supplied header is dropped — the browser is not a place
  // this secret can be trusted from.
  const signupToken = process.env.ABI_SIGNUP_TOKEN?.trim();
  const joinedPath = pathSegments.join("/");
  if (signupToken && SIGNUP_PATHS.has(joinedPath)) {
    headers.set("x-abi-signup-token", signupToken);
  } else {
    headers.delete("x-abi-signup-token");
  }

  let body: ArrayBuffer | undefined;
  if (req.method !== "GET" && req.method !== "HEAD") {
    body = await req.arrayBuffer();
  }

  try {
    const upstream = await fetch(dest, {
      method: req.method,
      headers,
      body: body && body.byteLength > 0 ? body : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    const contentType = upstream.headers.get("content-type") ?? "";
    // An upstream can return an HTML error or "waking up" page
    // instead of JSON. Surface that as a structured console state, never as a
    // cryptic HTML parse error in the browser.
    if (contentType.includes("text/html") || (contentType === "" && upstream.status >= 500)) {
      const preview = (await upstream.text()).slice(0, 240);
      const waking =
        /waking up|starting|cold start|loading/i.test(preview) || upstream.status === 503;
      // Express answers unknown routes with an HTML "Cannot GET /v1/..." page: the API is
      // reachable but its deployed version predates this console build.
      if (upstream.status === 404 && /Cannot (GET|POST|PUT|PATCH|DELETE) \//.test(preview)) {
        return NextResponse.json(
          {
            error: {
              code: "API_ROUTE_MISSING",
              message: `The ABI API does not have /${joined} yet — the deployed API is older than this console. Deploy the API from the same commit.`,
            },
          },
          { status: 404, headers: { "Cache-Control": "no-store" } },
        );
      }
      return NextResponse.json(
        {
          error: {
            code: waking ? "API_WAKING_UP" : "API_BAD_GATEWAY",
            message: waking
              ? "The API host is waking up from sleep. Wait a few seconds and retry — free instances pause when idle."
              : `The API returned a non-JSON response (HTTP ${upstream.status}). Check that ABI_API_ORIGIN points at the ABI API, not a status page.`,
            setup: waking
              ? {
                  tip: "Retry in a few seconds. If it persists, check the abi-api Worker in the Cloudflare dashboard (Workers Logs).",
                }
              : undefined,
          },
        },
        { status: waking ? 503 : 502, headers: { "Cache-Control": "no-store" } },
      );
    }

    const outHeaders = new Headers();
    for (const pass of ["content-type", "www-authenticate", "retry-after"]) {
      const v = upstream.headers.get(pass);
      if (v) outHeaders.set(pass, v);
    }
    // Session cookies are issued by the API but must reach the browser, and
    // there may be several (session + CSRF) — `get` would collapse them into
    // one comma-joined value that browsers mis-parse.
    // Strip any Domain= from upstream so the cookie binds to this console host
    // (the proxy is same-origin; an upstream Domain= would never stick here).
    const setCookies =
      typeof upstream.headers.getSetCookie === "function"
        ? upstream.headers.getSetCookie()
        : ([] as string[]);
    for (const cookie of setCookies) {
      outHeaders.append(
        "set-cookie",
        cookie.replace(/;\s*Domain=[^;]*/gi, "").replace(/;\s*domain=[^;]*/g, ""),
      );
    }

    outHeaders.set("Cache-Control", "no-store");
    return new NextResponse(upstream.body, { status: upstream.status, headers: outHeaders });
  } catch (e) {
    if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
      return NextResponse.json(
        {
          error: {
            code: "API_TIMEOUT",
            message: `The ABI API did not answer within ${UPSTREAM_TIMEOUT_MS / 1000}s. Retry shortly; a write may still have completed — refresh before repeating it.`,
          },
        },
        { status: 504, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(
      {
        error: {
          code: "API_UNREACHABLE",
          message: `Could not reach the ABI API at ${origin}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        },
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}

async function handle(req: NextRequest, pathSegments: string[]) {
  const origin = resolveOrigin();
  if (!origin) return notConfigured();
  return proxy(req, pathSegments, origin);
}

type Ctx = { params: Promise<{ path: string[] }> };

const route = (req: NextRequest, ctx: Ctx) =>
  ctx.params.then(({ path }) => handle(req, path ?? []));

export const GET = route;
export const POST = route;
export const PUT = route;
export const PATCH = route;
export const DELETE = route;
export const HEAD = route;
export const OPTIONS = route;
