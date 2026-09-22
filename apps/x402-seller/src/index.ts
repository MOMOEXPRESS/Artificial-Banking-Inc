/** Real x402 V2 demo seller. Settlement is delegated to a configured facilitator. */
import express from "express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";

const PORT = Number(process.env.PORT ?? 9402);
const FACILITATOR_URL = process.env.X402_FACILITATOR_URL ?? "https://x402.org/facilitator";
const NETWORK = process.env.CHAIN === "base" ? "eip155:8453" : "eip155:84532";
const PRICE_USDC = process.env.X402_PRICE_USDC ?? "$0.01";
const SELLER_ADDRESS = process.env.X402_SELLER_ADDRESS?.trim();

if (!SELLER_ADDRESS || !/^0x[a-fA-F0-9]{40}$/.test(SELLER_ADDRESS)) {
  throw new Error("X402_SELLER_ADDRESS must be the Base wallet that receives the USDC settlement.");
}

const app = express();
app.use(express.json());

const facilitator = new HTTPFacilitatorClient({
  url: FACILITATOR_URL,
  timeoutMs: 25_000,
});
const resourceServer = new x402ResourceServer(facilitator).register(NETWORK, new ExactEvmScheme());

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "abi-x402-seller",
    protocol: "x402-v2",
    network: NETWORK,
    price: PRICE_USDC,
    facilitator: FACILITATOR_URL,
    payTo: SELLER_ADDRESS,
  });
});

app.use(
  paymentMiddleware(
    {
      "GET /report": {
        accepts: {
          scheme: "exact",
          price: PRICE_USDC,
          network: NETWORK,
          payTo: SELLER_ADDRESS as `0x${string}`,
          maxTimeoutSeconds: 120,
        },
        description: "ABI merchant competitor-pricing report",
        mimeType: "application/json",
      },
    },
    resourceServer,
  ),
);

app.get("/report", (_req, res) => {
  res.json({
    report: "Competitor pricing summary",
    rows: [
      { vendor: "Acme API", plan: "Pro", pricePerMonthUsd: 49 },
      { vendor: "Globex Data", plan: "Team", pricePerMonthUsd: 99 },
      { vendor: "Initech Cloud", plan: "Scale", pricePerMonthUsd: 249 },
    ],
    generatedAt: new Date().toISOString(),
  });
});

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
    }),
  );
});
