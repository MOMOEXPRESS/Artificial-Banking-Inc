import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
          "No ABI API origin is configured. Set ABI_API_ORIGIN to the URL of the running API " +
          "(see docs/DEPLOY.md). The API is a persistent service; it is deliberately no longer " +
          "embedded in this deployment.",
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
    });
    const outHeaders = new Headers();
    for (const pass of ["content-type", "www-authenticate", "retry-after"]) {
      const v = upstream.headers.get(pass);
      if (v) outHeaders.set(pass, v);
    }
    // Session cookies are issued by the API but must reach the browser, and
    // there may be several (session + CSRF) — `get` would collapse them into
    // one comma-joined value that browsers mis-parse.
    const setCookies =
      typeof upstream.headers.getSetCookie === "function"
        ? upstream.headers.getSetCookie()
        : ([] as string[]);
    for (const cookie of setCookies) outHeaders.append("set-cookie", cookie);

    outHeaders.set("Cache-Control", "no-store");
    return new NextResponse(upstream.body, { status: upstream.status, headers: outHeaders });
  } catch (e) {
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
