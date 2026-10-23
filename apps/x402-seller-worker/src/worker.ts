/** Cloudflare Worker entrypoint for the ABI x402 demo seller. */
import {
  HTTPFacilitatorClient,
  x402HTTPResourceServer,
  x402ResourceServer,
} from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { configFromEnv, createSellerHandler, paidRoutes, type SellerEnv } from "./app.js";

let cached: { key: string; handle: (req: Request) => Promise<Response> } | null = null;

function handlerFor(env: SellerEnv) {
  const cfg = configFromEnv(env);
  const key = JSON.stringify(cfg);
  if (cached?.key === key) return cached.handle;
  const facilitator = new HTTPFacilitatorClient({ url: cfg.facilitatorUrl, timeoutMs: 25_000 });
  const resourceServer = new x402ResourceServer(facilitator).register(
    cfg.network,
    new ExactEvmScheme(),
  );
  const httpServer = new x402HTTPResourceServer(resourceServer, paidRoutes(cfg));
  cached = { key, handle: createSellerHandler(cfg, httpServer) };
  return cached.handle;
}

export default {
  async fetch(req: Request, env: SellerEnv): Promise<Response> {
    try {
      return await handlerFor(env)(req);
    } catch (err) {
      console.error(JSON.stringify({ type: "abi.x402-seller.config_error", message: String(err) }));
      return new Response(JSON.stringify({ error: "Internal Server Error" }), {
        status: 500,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }
  },
};
