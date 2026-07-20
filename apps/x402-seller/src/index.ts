/**
 * Demo x402 seller + dev facilitator.
 *
 * Seller: GET /report is a paid API ($1.20 USDC). Without an X-PAYMENT header
 * it answers HTTP 402 with payment requirements; with a valid payment it
 * returns the resource and an X-PAYMENT-RESPONSE settlement receipt.
 *
 * Dev facilitator (/facilitator/verify, /facilitator/settle): verifies the
 * EIP-712 TransferWithAuthorization signature cryptographically (real
 * verification, no chain) and fakes onchain settlement with a pseudo tx hash.
 * Going live = pointing FACILITATOR_URL at the hosted x402 facilitator; the
 * 402 dance itself is unchanged.
 */
import { randomBytes } from "node:crypto";
import express from "express";
import { verifyTypedData } from "viem";

const app = express();
app.use(express.json());

const PORT = Number(process.env.PORT ?? 9402);
const FACILITATOR_URL = process.env.FACILITATOR_URL ?? `http://localhost:${PORT}/facilitator`;
const NETWORK = "base-sepolia";
// Base Sepolia USDC contract (real address; settlement is mocked in dev)
const USDC_ASSET = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;
const SELLER_ADDRESS = "0x2222222222222222222222222222222222222222" as const;
const PRICE_MICRO = "1200000"; // $1.20

const AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

interface PaymentPayload {
  x402Version: number;
  scheme: string;
  network: string;
  payload: {
    signature: `0x${string}`;
    authorization: {
      from: `0x${string}`;
      to: `0x${string}`;
      value: string;
      validAfter: string;
      validBefore: string;
      nonce: `0x${string}`;
    };
  };
}

const requirements = {
  scheme: "exact",
  network: NETWORK,
  maxAmountRequired: PRICE_MICRO,
  resource: `http://localhost:${PORT}/report`,
  description: "Competitor pricing report (demo paid API)",
  payTo: SELLER_ADDRESS,
  asset: USDC_ASSET,
  maxTimeoutSeconds: 120,
};

// Replay protection: a nonce is accepted once.
const seenNonces = new Set<string>();

// ---------------------------------------------------------------- facilitator

app.post("/facilitator/verify", async (req, res) => {
  const { paymentHeader } = req.body as { paymentHeader: string };
  try {
    const payment = JSON.parse(
      Buffer.from(paymentHeader, "base64").toString("utf8"),
    ) as PaymentPayload;
    const auth = payment.payload.authorization;

    if (payment.scheme !== "exact" || payment.network !== NETWORK) {
      return res.json({ isValid: false, invalidReason: "scheme/network mismatch" });
    }
    if (auth.to.toLowerCase() !== SELLER_ADDRESS.toLowerCase()) {
      return res.json({ isValid: false, invalidReason: "payTo mismatch" });
    }
    if (BigInt(auth.value) < BigInt(PRICE_MICRO)) {
      return res.json({ isValid: false, invalidReason: "insufficient value" });
    }
    const nowSec = Math.floor(Date.now() / 1000);
    if (nowSec < Number(auth.validAfter) || nowSec > Number(auth.validBefore)) {
      return res.json({ isValid: false, invalidReason: "authorization expired" });
    }
    if (seenNonces.has(auth.nonce)) {
      return res.json({ isValid: false, invalidReason: "nonce replay" });
    }

    const signatureValid = await verifyTypedData({
      address: auth.from,
      domain: {
        name: "USD Coin",
        version: "2",
        chainId: 84532,
        verifyingContract: USDC_ASSET,
      },
      types: AUTHORIZATION_TYPES,
      primaryType: "TransferWithAuthorization",
      message: {
        from: auth.from,
        to: auth.to,
        value: BigInt(auth.value),
        validAfter: BigInt(auth.validAfter),
        validBefore: BigInt(auth.validBefore),
        nonce: auth.nonce,
      },
      signature: payment.payload.signature,
    });
    if (!signatureValid) {
      return res.json({ isValid: false, invalidReason: "bad signature" });
    }
    return res.json({ isValid: true, payer: auth.from });
  } catch (e) {
    return res.json({ isValid: false, invalidReason: `malformed payment: ${String(e)}` });
  }
});

app.post("/facilitator/settle", (req, res) => {
  const { paymentHeader } = req.body as { paymentHeader: string };
  try {
    const payment = JSON.parse(
      Buffer.from(paymentHeader, "base64").toString("utf8"),
    ) as PaymentPayload;
    seenNonces.add(payment.payload.authorization.nonce);
    // Dev: no chain — fabricate a settlement receipt.
    return res.json({
      success: true,
      txHash: `0x${randomBytes(32).toString("hex")}`,
      networkId: NETWORK,
    });
  } catch (e) {
    return res.status(400).json({ success: false, error: String(e) });
  }
});

// --------------------------------------------------------------------- seller

app.get("/report", async (req, res) => {
  const paymentHeader = req.header("x-payment");
  if (!paymentHeader) {
    return res.status(402).json({
      x402Version: 1,
      error: "X-PAYMENT header is required",
      accepts: [requirements],
    });
  }

  const verifyRes = await fetch(`${FACILITATOR_URL}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paymentHeader, paymentRequirements: requirements }),
  });
  const verdict = (await verifyRes.json()) as { isValid: boolean; invalidReason?: string };
  if (!verdict.isValid) {
    return res.status(402).json({
      x402Version: 1,
      error: `payment invalid: ${verdict.invalidReason}`,
      accepts: [requirements],
    });
  }

  const settleRes = await fetch(`${FACILITATOR_URL}/settle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paymentHeader, paymentRequirements: requirements }),
  });
  const settlement = await settleRes.json();

  res.setHeader(
    "X-PAYMENT-RESPONSE",
    Buffer.from(JSON.stringify(settlement)).toString("base64"),
  );
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

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "x402-seller-demo", priceMicro: PRICE_MICRO });
});

app.listen(PORT, () => {
  console.log(`x402 seller demo on http://localhost:${PORT} (report costs $1.20 USDC)`);
  console.log(`Dev facilitator at ${FACILITATOR_URL} — swap FACILITATOR_URL to go live.`);
});
