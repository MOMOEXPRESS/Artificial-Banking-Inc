/** Real x402 V2 demo seller. Settlement is delegated to a configured facilitator. */
import { HTTPFacilitatorClient } from "@x402/core/server";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import {
  assertPaymentHeaderBudget,
  createSellerApp,
  paidRoutes,
  type SellerConfig,
} from "./app.js";

const PORT = Number(process.env.PORT ?? 9402);
const FACILITATOR_URL = process.env.X402_FACILITATOR_URL ?? "https://x402.org/facilitator";
const NETWORK = process.env.CHAIN === "base" ? "eip155:8453" : "eip155:84532";
const PRICE_USDC = process.env.X402_PRICE_USDC ?? "$0.01";
const SELLER_ADDRESS = process.env.X402_SELLER_ADDRESS?.trim();

if (!SELLER_ADDRESS || !/^0x[a-fA-F0-9]{40}$/.test(SELLER_ADDRESS)) {
  throw new Error("X402_SELLER_ADDRESS must be the Base wallet that receives the USDC settlement.");
}

const cfg: SellerConfig = {
  network: NETWORK,
  price: PRICE_USDC,
  payTo: SELLER_ADDRESS as `0x${string}`,
  facilitatorUrl: FACILITATOR_URL,
};

// Refuse to boot if the challenge header would blow the proxy header budget.
const headerBytes = assertPaymentHeaderBudget(
  cfg,
  process.env.X402_PUBLIC_URL ?? `http://localhost:${PORT}/report`,
);

const facilitator = new HTTPFacilitatorClient({
  url: FACILITATOR_URL,
  timeoutMs: 25_000,
});
const resourceServer = new x402ResourceServer(facilitator).register(NETWORK, new ExactEvmScheme());

const app = createSellerApp(cfg, paymentMiddleware(paidRoutes(cfg), resourceServer));

app.listen(PORT, () => {
  console.log(
    JSON.stringify({
      type: "abi.x402-seller.started",
      port: PORT,
      protocol: "x402-v2",
      network: NETWORK,
      price: PRICE_USDC,
      payTo: SELLER_ADDRESS,
      facilitator: FACILITATOR_URL,
      paymentRequiredHeaderBytes: headerBytes,
    }),
  );
});
