/**
 * x402 client rail: PolicyVault performs the HTTP 402 payment dance on behalf
 * of the agent, signing via the registered CustodyProvider. The agent never
 * sees the key — it only receives the paid resource and a receipt.
 *
 * Flow (x402 "exact" scheme):
 *   1. GET resource → 402 + accepts[] payment requirements
 *   2. Check the seller's price against the policy-authorized amount
 *   3. Sign an EIP-712 TransferWithAuthorization for exactly the price
 *   4. Retry with X-PAYMENT header → seller verifies via its facilitator → 200
 *
 * Works fully locally against apps/x402-seller (dev facilitator). Going live
 * on Base mainnet/Sepolia = the SELLER pointing at the real x402 facilitator
 * and this wallet holding real USDC; the client dance below is unchanged.
 */
import { randomBytes } from "node:crypto";
import { getCustodyProvider } from "@policyvault/custody";
import type { MicroUsdc } from "@policyvault/common";
import type { PaymentRail, PaymentRailContext, PaymentRailResult } from "./types.js";

export interface PaymentRequirements {
  scheme: string;
  network: string;
  maxAmountRequired: string; // micro-USDC (6-decimal base units)
  resource: string;
  description?: string;
  payTo: `0x${string}`;
  asset: `0x${string}`;
  maxTimeoutSeconds?: number;
}

export interface X402Receipt {
  /** What was actually charged (seller price), in micro-USDC */
  amountMicro: MicroUsdc;
  network: string;
  payer: `0x${string}`;
  payTo: `0x${string}`;
  txHash?: string;
  settled: boolean;
}

export class X402Error extends Error {
  constructor(
    public code:
      | "PRICE_EXCEEDS_AUTHORIZED"
      | "NO_PAYMENT_REQUIRED"
      | "UNSUPPORTED_SCHEME"
      | "SELLER_REJECTED"
      | "RAIL_FAILED"
      | "CUSTODY_UNAVAILABLE",
    message: string,
  ) {
    super(message);
    this.name = "X402Error";
  }
}

export const AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export function eip712Domain(network: string, asset: `0x${string}`) {
  return {
    name: "USD Coin",
    version: "2",
    chainId: network === "base" ? 8453 : 84532, // base-sepolia default
    verifyingContract: asset,
  } as const;
}

/**
 * Token contracts we are willing to sign a transfer authorization for. The
 * seller proposes the asset; without this pin it could name any contract —
 * including one it controls — and we would sign away a transfer of it.
 */
const ALLOWED_ASSETS: Record<string, string> = {
  "base-sepolia": "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
  base: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
};

/** Never sign an authorization valid for longer than this, whatever the seller asks. */
const MAX_AUTHORIZATION_SECONDS = 120;

export async function payViaX402(args: {
  url: string;
  /** Policy-authorized ceiling for this intent, micro-USDC */
  authorizedMicro: MicroUsdc;
  orgId: string;
  /** Destinations the guardian has blocked — the payee is checked against these. */
  blocklist?: string[];
  fetchImpl?: typeof fetch;
}): Promise<{ receipt: X402Receipt; resource: unknown; contentType: string | null }> {
  const doFetch = args.fetchImpl ?? fetch;
  const custody = getCustodyProvider();
  const addr = await custody.getAddress(args.orgId);
  if (!addr) {
    throw new X402Error(
      "CUSTODY_UNAVAILABLE",
      "Org has no custody address — recreate org or configure CDP",
    );
  }

  const first = await doFetch(args.url, {
    signal: AbortSignal.timeout(10_000),
    redirect: "error",
  });
  if (first.status !== 402) {
    if (first.ok) {
      throw new X402Error("NO_PAYMENT_REQUIRED", "Resource did not request payment (HTTP 200)");
    }
    throw new X402Error("RAIL_FAILED", `Seller returned HTTP ${first.status}`);
  }

  const challenge = (await first.json().catch(() => ({}))) as { accepts?: PaymentRequirements[] };
  const requirement = challenge.accepts?.find(
    (a) => a.scheme === "exact" && (a.network === "base-sepolia" || a.network === "base"),
  );
  if (!requirement) {
    throw new X402Error("UNSUPPORTED_SCHEME", "No supported x402 payment scheme in accepts[]");
  }

  // The seller controls every field below. Validate before signing anything.
  const expectedAsset = ALLOWED_ASSETS[requirement.network];
  if (!expectedAsset || requirement.asset?.toLowerCase() !== expectedAsset) {
    throw new X402Error(
      "UNSUPPORTED_SCHEME",
      `Seller asked to be paid in an unrecognised token (${requirement.asset}) — refusing to sign.`,
    );
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(requirement.payTo ?? "")) {
    throw new X402Error("SELLER_REJECTED", `Malformed payTo address: ${requirement.payTo}`);
  }
  if (args.blocklist?.some((b) => b.toLowerCase() === requirement.payTo.toLowerCase())) {
    throw new X402Error("SELLER_REJECTED", `Seller's payout address is blocklisted: ${requirement.payTo}`);
  }

  let priceMicro: bigint;
  try {
    priceMicro = BigInt(requirement.maxAmountRequired);
  } catch {
    throw new X402Error("SELLER_REJECTED", `Malformed price: ${requirement.maxAmountRequired}`);
  }
  if (priceMicro <= 0n) {
    throw new X402Error("SELLER_REJECTED", `Seller quoted a non-positive price: ${priceMicro}`);
  }
  if (priceMicro > args.authorizedMicro) {
    throw new X402Error(
      "PRICE_EXCEEDS_AUTHORIZED",
      `Seller price ${requirement.maxAmountRequired} exceeds authorized ${args.authorizedMicro}`,
    );
  }

  const nowSec = Math.floor(Date.now() / 1000);
  // Clamp the validity window: a seller-chosen expiry could leave a signed,
  // redeemable authorization alive long after we released the hold.
  const ttl = Math.min(requirement.maxTimeoutSeconds ?? 60, MAX_AUTHORIZATION_SECONDS);
  const authorization = {
    from: addr.address,
    to: requirement.payTo,
    value: priceMicro,
    validAfter: BigInt(nowSec - 60),
    validBefore: BigInt(nowSec + ttl),
    nonce: `0x${randomBytes(32).toString("hex")}` as `0x${string}`,
  };
  let signature: `0x${string}`;
  try {
    signature = await custody.signTypedData({
      orgId: args.orgId,
      typedData: {
        domain: { ...eip712Domain(requirement.network, requirement.asset) },
        types: { ...AUTHORIZATION_TYPES },
        primaryType: "TransferWithAuthorization",
        message: authorization as unknown as Record<string, unknown>,
      },
    });
  } catch (e) {
    throw new X402Error(
      "CUSTODY_UNAVAILABLE",
      e instanceof Error ? e.message : "Custody provider failed to sign",
    );
  }

  const paymentHeader = Buffer.from(
    JSON.stringify({
      x402Version: 1,
      scheme: "exact",
      network: requirement.network,
      payload: {
        signature,
        authorization: {
          ...authorization,
          value: authorization.value.toString(),
          validAfter: authorization.validAfter.toString(),
          validBefore: authorization.validBefore.toString(),
        },
      },
    }),
  ).toString("base64");

  const paid = await doFetch(args.url, {
    headers: { "X-PAYMENT": paymentHeader },
    signal: AbortSignal.timeout(15_000),
    redirect: "error",
  });
  if (!paid.ok) {
    const body = await paid.text().catch(() => "");
    throw new X402Error("SELLER_REJECTED", `Seller rejected payment: HTTP ${paid.status} ${body}`);
  }

  let settlement: { txHash?: string; success?: boolean } = {};
  const settleHeader = paid.headers.get("x-payment-response");
  if (settleHeader) {
    try {
      settlement = JSON.parse(Buffer.from(settleHeader, "base64").toString("utf8"));
    } catch {
      /* tolerate absent/opaque settlement info */
    }
  }

  const contentType = paid.headers.get("content-type");
  const resource = contentType?.includes("application/json")
    ? await paid.json()
    : await paid.text();

  return {
    receipt: {
      amountMicro: priceMicro,
      network: requirement.network,
      payer: addr.address,
      payTo: requirement.payTo,
      txHash: settlement.txHash,
      // Require an explicit success flag — missing/undefined must not book a payment.
      settled: settlement.success === true,
    },
    resource,
    contentType,
  };
}

/** PaymentRail adapter around payViaX402. */
export class X402Rail implements PaymentRail {
  readonly name = "x402";

  async settle(ctx: PaymentRailContext): Promise<PaymentRailResult> {
    if (!/^https?:\/\//i.test(ctx.destination)) {
      throw new X402Error("RAIL_FAILED", "x402 rail requires an http(s) destination URL");
    }
    const paid = await payViaX402({
      url: ctx.destination,
      authorizedMicro: ctx.authorizedMicro,
      orgId: ctx.orgId,
      blocklist: ctx.blocklist,
    });
    return {
      chargedMicro: paid.receipt.amountMicro,
      rail: this.name,
      txHash: paid.receipt.txHash,
      resource: paid.resource,
      contentType: paid.contentType,
      settled: paid.receipt.settled,
    };
  }
}
