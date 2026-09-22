# ABI TypeScript SDK

Typed clients for Artificial Banking Incorporated's agent authorization and
guardian APIs. The model receives an agent credential; it never receives a
wallet private key.

## Install

```bash
npm install @policyvault/sdk
```

## Pay an x402 V2 API

```ts
import { PolicyVaultClient } from "@policyvault/sdk";

const abi = new PolicyVaultClient({
  baseUrl: process.env.ABI_API_URL!,
  apiKey: process.env.ABI_AGENT_API_KEY!,
});

const result = await abi.payApi({
  amountUsdc: "0.05", // policy-authorized ceiling, not a blind charge
  destination: "https://seller.example/report",
  idempotencyKey: crypto.randomUUID(),
});

console.log(result.outcome, result.txHash, result.resource);
```

For Base Sepolia, a successful x402 V2 response includes the facilitator's
authentic transaction hash. ABI refuses V1 challenges, unapproved assets,
blocklisted recipients, prices above the authorized ceiling, and responses
without a successful settlement receipt.

## Onboard a seller

```ts
import { AbiGuardianClient } from "@policyvault/sdk";

const guardian = new AbiGuardianClient({
  baseUrl: process.env.ABI_API_URL!,
  apiKey: process.env.ABI_GUARDIAN_KEY!,
});

const { merchant } = await guardian.onboardMerchantGateway({
  label: "Acme Data",
  endpoint: "https://seller.example/report",
  payoutAddress: "0x1111111111111111111111111111111111111111",
  priceUsdc: "0.01",
  category: "data",
  network: "eip155:84532",
});

await guardian.verifyMerchantGateway((merchant as { id: string }).id);
```

Use an account session for the browser console. Guardian and agent bearer keys
belong in server-side environment secrets or a secret manager, never
`localStorage`.
