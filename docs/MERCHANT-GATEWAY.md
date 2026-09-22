# Merchant Gateway: accept x402 V2 test payments

ABI's Merchant Gateway registers an independent seller's paid endpoint and checks
its unpaid payment challenge. The seller receives USDC directly at its own Base
wallet. The gateway does not create a wallet, hold seller funds, verify the
seller's identity, or prove the seller controls the payout address.

## 1. Serve a paid GET endpoint

Install `@x402/core`, `@x402/express`, and `@x402/evm` in your own Express
server. Configure a facilitator that supports the network you use. This
example runs on Base Sepolia; replace `/report` with your resource route.

```ts
import express from "express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";

const network = "eip155:84532";
const payout = process.env.X402_SELLER_ADDRESS as `0x${string}`;
if (!/^0x[a-fA-F0-9]{40}$/.test(payout ?? "")) throw new Error("Set seller wallet");
const facilitator = new HTTPFacilitatorClient({
  url: process.env.X402_FACILITATOR_URL ?? "https://x402.org/facilitator",
});
const server = new x402ResourceServer(facilitator).register(network, new ExactEvmScheme());
const app = express();
app.use(
  paymentMiddleware(
    {
      "GET /report": {
        accepts: { scheme: "exact", network, payTo: payout, price: "$0.01" },
        description: "Paid report",
        mimeType: "application/json",
      },
    },
    server,
  ),
);
app.get("/report", (_req, res) => res.json({ report: "Your paid data" }));
app.listen(process.env.PORT ?? 9402);
```

The runnable version is `apps/x402-seller/src/index.ts`. Serve your own
HTTPS endpoint; the default ABI verification blocks private and loopback
addresses. Unpaid `GET /report` must respond **402** with an x402 V2
`PAYMENT-REQUIRED` header declaring Base Sepolia, Base Sepolia USDC, your
payout wallet, and 10,000 USDC micro units for the example $0.01 price.

## 2. Register and verify

In the ABI console, open **Settings → Merchants**, enter your HTTPS paid
endpoint, payout address, price and Base Sepolia, then create the seller
profile. Select the profile and choose **Verify**. ABI requests the endpoint
without a payment and compares the V2 `exact` challenge with the declared
network, USDC token, wallet and amount. A failed check reports the observed
HTTP status or mismatch. Fix the server configuration and retry. Verification
checks protocol configuration, not identity or ownership.

## 3. Make a buyer test payment

Add the **exact URL** to the ABI buyer agent's policy allowlist. Fund the
testnet agent with Base Sepolia USDC and enough ETH for gas, then invoke
`pay_api` with that destination and the same USDC amount. Approve the request
if policy routes it to a guardian. A successful seller must fulfill the paid
request, returning the resource and a V2 `PAYMENT-RESPONSE` receipt with the
settlement transaction hash. Open the seller profile's **Payment activity**
to inspect state and the receipt on Base Sepolia Basescan. Check the chain
explorer for actual token transfer and recipient: a seller-provided receipt
is not independent chain verification. Failed requests have no settled
on-chain receipt. Network mismatches, prices, policy denies, insufficient
funds or unavailable facilitators can stop payment; inspect buyer decisions
and the seller/facilitator logs to distinguish them.

The activity view shows up to 100 most recent `pay_api` settlement attempts
for this organization and exact endpoint. It does not include payments
processed outside ABI. Base mainnet requires separate production custody,
operations, compliance and independent settlement validation before use.
