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

const ALARM_MS = 60_000;
const SINGLETON_NAME = "abi-api";

let sharedServer: Server | null = null;
let sharedPort: number | null = null;

type ExpressApp = {
  handle: (req: unknown, res: unknown) => void;
  use: (...args: unknown[]) => unknown;
};

function bindStore(ctx: DurableObjectState): void {
  const database = createDoDatabase(ctx.storage.sql, (fn) => {
    ctx.storage.transactionSync(fn);
  });
  globalThis.__ABI_STORE_DB__ = database;
}

async function ensureExpressServer(app: ExpressApp): Promise<number> {
  if (sharedPort != null && sharedServer) return sharedPort;

  app.use(
    (
      req: { headers: Record<string, string | string[] | undefined>; ip?: string },
      _res: unknown,
      next: () => void,
    ) => {
      const cf = header(req.headers, "cf-connecting-ip");
      const xff = header(req.headers, "x-forwarded-for")?.split(",")[0]?.trim();
      const ip = cf || xff;
      if (ip) req.ip = ip;
      next();
    },
  );

  sharedServer = createServer(app as unknown as Parameters<typeof createServer>[0]);
  sharedPort = await new Promise<number>((resolve, reject) => {
    sharedServer!.once("error", reject);
    sharedServer!.listen(0, () => {
      const addr = sharedServer!.address();
      if (addr && typeof addr === "object") resolve(addr.port);
      else reject(new Error("Express server failed to bind a port"));
    });
  });

  const { setMcpInternalFetch } = await import("@policyvault/api/mcp-internal");
  const port = sharedPort;
  setMcpInternalFetch((request) => handleAsNodeRequest(port, request));
  return port;
}

export class AbiApi extends DurableObject<Env> {
  #port: Promise<number>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.#port = ctx.blockConcurrencyWhile(async () => {
      applyWorkerEnv(env);
      bindStore(ctx);
      // Import after DB bind so schema migrations use DO SQL.
      const api = await import("@policyvault/api/worker-app");
      const port = await ensureExpressServer(api.app as unknown as ExpressApp);
      const existing = await ctx.storage.getAlarm();
      if (existing === null) {
        await ctx.storage.setAlarm(Date.now() + ALARM_MS);
      }
      return port;
    });
  }

  async fetch(request: Request): Promise<Response> {
    applyWorkerEnv(this.env);
    bindStore(this.ctx);
    const port = await this.#port;
    return handleAsNodeRequest(port, withClientIpHeaders(request));
  }

  async alarm(): Promise<void> {
    applyWorkerEnv(this.env);
    bindStore(this.ctx);
    await this.#port;
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
