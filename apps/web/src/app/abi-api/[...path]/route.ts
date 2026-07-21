import { NextRequest, NextResponse } from "next/server";
import { dispatchExpress } from "@/lib/express-fetch";
import { hydrateDbFromCache, persistDbToCache } from "@/lib/vercel-db-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Bootstrap + policy eval can exceed default hobby limits on cold start. */
export const maxDuration = 60;

/**
 * Same-origin API for the Guardian Console.
 *
 * - If ABI_API_ORIGIN (or absolute POLICYVAULT_API_URL / NEXT_PUBLIC_API_URL) is set → proxy.
 * - Else on Vercel → embed @policyvault/api in-process (SQLite under /tmp) so Bootstrap works
 *   without a separate API host.
 * - Else locally → proxy to http://127.0.0.1:8787 (run `npm run dev:api`).
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

async function proxyToOrigin(req: NextRequest, pathSegments: string[], origin: string) {
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

  try {
    const upstream = await fetch(dest, {
      method: req.method,
      headers,
      body: body && body.byteLength > 0 ? body : undefined,
      redirect: "manual",
    });
    const outHeaders = new Headers();
    const ct = upstream.headers.get("content-type");
    if (ct) outHeaders.set("content-type", ct);
    outHeaders.set("Cache-Control", "no-store");
    return new NextResponse(upstream.body, { status: upstream.status, headers: outHeaders });
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
}

function ensureEmbedEnv() {
  // Evaluated before the API module loads — enables demo bootstrap on Vercel production.
  if (process.env.POLICYVAULT_ALLOW_BOOTSTRAP === undefined) {
    process.env.POLICYVAULT_ALLOW_BOOTSTRAP = "1";
  }
  if (!process.env.POLICYVAULT_DB) {
    process.env.POLICYVAULT_DB = "/tmp/policyvault.db";
  }
  if (!process.env.ABI_KEY_PEPPER && !process.env.POLICYVAULT_KEY_PEPPER) {
    process.env.ABI_KEY_PEPPER = "abi-vercel-demo-pepper";
  }
  process.env.ABI_EMBEDDED = "1";
}

type EmbeddedApi = {
  app: Parameters<typeof dispatchExpress>[0];
  closeDb: () => void;
  reloadDbFromDisk: () => void;
  flushDbForPersist: () => void;
  getDbPath: () => string;
};

/** Warm isolate: API module already opened SQLite; hydrate must reload from disk. */
let embeddedApi: EmbeddedApi | null = null;

async function handleEmbedded(req: NextRequest, pathSegments: string[]) {
  ensureEmbedEnv();
  const dbPath = process.env.POLICYVAULT_DB ?? "/tmp/policyvault.db";

  try {
    // Order: close (warm) → hydrate file → import (cold) or reloadDbFromDisk (warm).
    if (embeddedApi) {
      embeddedApi.closeDb();
    }
    await hydrateDbFromCache(dbPath);

    if (embeddedApi) {
      embeddedApi.reloadDbFromDisk();
    } else {
      const mod = await import("@policyvault/api");
      embeddedApi = mod as unknown as EmbeddedApi;
    }

    const joined = pathSegments.map(encodeURIComponent).join("/");
    const search = new URL(req.url).search;
    const pathAndQuery = `/${joined}${search}`;
    const response = await dispatchExpress(embeddedApi.app, req, pathAndQuery);

    embeddedApi.flushDbForPersist();
    await persistDbToCache(embeddedApi.getDbPath());

    return response;
  } catch (e) {
    console.error("[abi-api embed]", e);
    return NextResponse.json(
      {
        error: {
          code: "API_EMBED_FAILED",
          message: e instanceof Error ? e.message : String(e),
        },
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

async function handle(req: NextRequest, pathSegments: string[]) {
  const origin = resolveOrigin();
  if (origin) return proxyToOrigin(req, pathSegments, origin);
  // Vercel with no external API → run the money API in-process.
  if (process.env.VERCEL) return handleEmbedded(req, pathSegments);
  return proxyToOrigin(req, pathSegments, "http://127.0.0.1:8787");
}

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return handle(req, path ?? []);
}
export async function POST(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return handle(req, path ?? []);
}
export async function PUT(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return handle(req, path ?? []);
}
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return handle(req, path ?? []);
}
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return handle(req, path ?? []);
}
export async function HEAD(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return handle(req, path ?? []);
}
export async function OPTIONS(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return handle(req, path ?? []);
}
