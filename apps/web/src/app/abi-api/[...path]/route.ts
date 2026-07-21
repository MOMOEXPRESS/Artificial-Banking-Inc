import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Same-origin API proxy for the Guardian Console.
 *
 * Local / Cursor: falls back to http://127.0.0.1:8787 when ABI_API_ORIGIN is unset.
 * Vercel: requires ABI_API_ORIGIN (or POLICYVAULT_API_URL / absolute NEXT_PUBLIC_API_URL)
 * so /abi-api never returns an opaque Next/platform 404.
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
  if (!process.env.VERCEL) return "http://127.0.0.1:8787";
  return null;
}

async function proxy(req: NextRequest, pathSegments: string[]) {
  const origin = resolveOrigin();
  if (!origin) {
    return NextResponse.json(
      {
        error: {
          code: "API_NOT_CONFIGURED",
          message:
            "This web deployment has no API origin. Set ABI_API_ORIGIN (server) to your API host — e.g. https://api.example.com — then Redeploy. Vercel hosts the console only; the money API is a separate process.",
          docs: "https://github.com/MOMOEXPRESS/Artificial-Banking-Inc/blob/main/docs/VERCEL.md",
        },
      },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  const joined = pathSegments.map(encodeURIComponent).join("/");
  const incoming = new URL(req.url);
  const dest = `${origin}/${joined}${incoming.search}`;

  const headers = new Headers();
  const pass = ["authorization", "content-type", "accept", "idempotency-key", "x-request-id"];
  for (const key of pass) {
    const v = req.headers.get(key);
    if (v) headers.set(key, v);
  }

  let body: ArrayBuffer | undefined;
  if (req.method !== "GET" && req.method !== "HEAD") {
    body = await req.arrayBuffer();
  }

  let upstream: Response;
  try {
    upstream = await fetch(dest, {
      method: req.method,
      headers,
      body: body && body.byteLength > 0 ? body : undefined,
      redirect: "manual",
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: {
          code: "API_UNREACHABLE",
          message: `Could not reach API at ${origin}: ${e instanceof Error ? e.message : String(e)}`,
        },
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }

  const outHeaders = new Headers();
  const ct = upstream.headers.get("content-type");
  if (ct) outHeaders.set("content-type", ct);
  outHeaders.set("Cache-Control", "no-store");

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: outHeaders,
  });
}

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return proxy(req, path ?? []);
}
export async function POST(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return proxy(req, path ?? []);
}
export async function PUT(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return proxy(req, path ?? []);
}
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return proxy(req, path ?? []);
}
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return proxy(req, path ?? []);
}
export async function HEAD(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return proxy(req, path ?? []);
}
export async function OPTIONS(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return proxy(req, path ?? []);
}
