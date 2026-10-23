/**
 * Thin Worker → single SQLite Durable Object hosting the Express ABI API.
 *
 * Path A from the porting plan: one named DO keeps ledger transactions
 * synchronous; background work runs on a ~60s alarm.
 */
import { DurableObject } from "cloudflare:workers";
import { createServer, type Server } from "node:http";
import { handleAsNodeRequest } from "cloudflare:node";
import { applyWorkerEnv } from "./env.js";
import { withClientIpHeaders } from "./client-ip.js";
import { createDoDatabase } from "./storage/do-sql.js";

const INTERNAL_PORT = 8787;
const ALARM_MS = 60_000;
const SINGLETON_NAME = "abi-api";

type ExpressApp = {
  handle: (req: unknown, res: unknown) => void;
  use: (...args: unknown[]) => unknown;
};

export class AbiApi extends DurableObject<Env> {
  #ready: Promise<void> | null = null;
  #server: Server | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.#ready = ctx.blockConcurrencyWhile(() => this.#boot());
  }

  async #boot(): Promise<void> {
    applyWorkerEnv(this.env);

    const database = createDoDatabase(this.ctx.storage.sql, (fn) => {
      this.ctx.storage.transactionSync(fn);
    });
    globalThis.__ABI_STORE_DB__ = database;

    // Dynamic import after DB injection so store.ts migrations use DO SQL.
    const api = await import("@policyvault/api/worker-app");
    const app = api.app as unknown as ExpressApp;

    // Prefer CF-Connecting-IP / x-forwarded-for for rate limits (req.ip).
    app.use((req: { headers: Record<string, string | string[] | undefined>; ip?: string }, _res, next) => {
      const cf = header(req.headers, "cf-connecting-ip");
      const xff = header(req.headers, "x-forwarded-for")?.split(",")[0]?.trim();
      const ip = cf || xff;
      if (ip) req.ip = ip;
      next();
    });

    if (!this.#server) {
      this.#server = createServer(app as unknown as Parameters<typeof createServer>[0]);
      await new Promise<void>((resolve) => {
        this.#server!.listen(INTERNAL_PORT, () => resolve());
      });
    }

    // MCP tools must not HTTP-loopback to 127.0.0.1 on Workers — bridge instead.
    const { setMcpInternalFetch } = await import("@policyvault/api/mcp-internal");
    setMcpInternalFetch((request) => handleAsNodeRequest(INTERNAL_PORT, request));

    if (process.env.ABI_SPIKE_ROUTES === "1") {
      const { registerSpikeRoutes } = await import("./spike-routes.js");
      registerSpikeRoutes(app as unknown as import("express").Express);
    }

    // Keep a light alarm so jobs run without setInterval.
    const existing = await this.ctx.storage.getAlarm();
    if (existing === null) {
      await this.ctx.storage.setAlarm(Date.now() + ALARM_MS);
    }
  }

  async fetch(request: Request): Promise<Response> {
    await this.#ready;
    const forwarded = withClientIpHeaders(request);
    return handleAsNodeRequest(INTERNAL_PORT, forwarded);
  }

  async alarm(): Promise<void> {
    await this.#ready;
    applyWorkerEnv(this.env);
    try {
      const { runAlarmJobs } = await import("@policyvault/api/worker-app");
      await runAlarmJobs();
    } catch (error) {
      console.error("abi.alarm failed:", error);
    } finally {
      await this.ctx.storage.setAlarm(Date.now() + ALARM_MS);
    }
  }
}

function header(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}

/** Forward every request to the singleton Durable Object. */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const id = env.ABI.idFromName(SINGLETON_NAME);
    const stub = env.ABI.get(id);
    return stub.fetch(request);
  },
};
