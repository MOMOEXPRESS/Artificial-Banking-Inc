/** x402 V2 buyer rail. ABI authorizes; the SDK constructs the payment payload. */
import { getCustodyProvider } from "@policyvault/custody";
import type { MicroUsdc } from "@policyvault/common";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import type { PaymentRequired, PaymentRequirements } from "@x402/core/types";
import { ExactEvmScheme, type ClientEvmSigner } from "@x402/evm";
import { createHash, randomBytes } from "node:crypto";
import { outboundUrlProblem, resolveAndPinOutboundUrl } from "../outbound-url.js";
import { tokenDomain } from "../chain/token-domain.js";
import type { PaymentRail, PaymentRailContext, PaymentRailResult } from "./types.js";

const ALL_NETWORKS = {
  "eip155:84532": { legacy: "base-sepolia", asset: "0x036cbd53842c5426634e7929541ec2318f3dcf7e" },
  "eip155:8453": { legacy: "base", asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" },
} as const;

type X402Network = keyof typeof ALL_NETWORKS;

/**
 * Networks the buyer may accept. Defaults to the configured CHAIN so a Sepolia
 * deployment cannot accidentally pay a mainnet seller requirement.
 */
export function allowedX402Networks(): Set<X402Network> {
  const raw = process.env.ABI_X402_NETWORKS?.trim();
  if (raw) {
    const out = new Set<X402Network>();
    for (const part of raw.split(",")) {
      const n = part.trim() as X402Network;
      if (n in ALL_NETWORKS) out.add(n);
    }
    if (out.size > 0) return out;
  }
  const chain = (process.env.CHAIN ?? "base-sepolia").trim().toLowerCase();
  if (chain === "base" || chain === "eip155:8453") return new Set(["eip155:8453"]);
  return new Set(["eip155:84532"]);
}

/** Exported for domain/signature regression tests and custody adapters. */
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
  const legacy = network === "base" || network === "eip155:8453" ? "base" : "base-sepolia";
  const domain = tokenDomain(legacy, asset);
  return {
    name: domain.name,
    version: domain.version,
    chainId: domain.chainId,
    verifyingContract: domain.verifyingContract,
  } as const;
}

export interface X402Receipt {
  amountMicro: MicroUsdc;
  network: X402Network;
  payer: `0x${string}`;
  payTo: `0x${string}`;
  txHash: `0x${string}`;
  settled: true;
  /** EIP-3009 nonce when present — used for reconciliation. */
  authorizationNonce?: string;
}

export type RailErrorCode =
  | "PRICE_EXCEEDS_AUTHORIZED"
  | "NO_PAYMENT_REQUIRED"
  | "UNSUPPORTED_SCHEME"
  | "SELLER_REJECTED"
  | "RAIL_FAILED"
  | "CUSTODY_UNAVAILABLE"
  | "INVALID_DESTINATION"
  | "INSUFFICIENT_ONCHAIN_USDC"
  | "INSUFFICIENT_GAS";

export class X402Error extends Error {
  constructor(
    public code: RailErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "X402Error";
  }
}

function isAddress(value: string): value is `0x${string}` {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function isTxHash(value: string): value is `0x${string}` {
  return /^0x[a-fA-F0-9]{64}$/.test(value);
}

function selectRequirement(
  required: PaymentRequired,
  authorizedMicro: bigint,
  blocklist: string[],
): { requirement: PaymentRequirements; priceMicro: bigint; network: X402Network } {
  if (required.x402Version !== 2) {
    throw new X402Error(
      "UNSUPPORTED_SCHEME",
      `Seller offered x402 V${required.x402Version}; ABI requires V2.`,
    );
  }
  const allowed = allowedX402Networks();
  const requirement = required.accepts.find(
    (r) =>
      r.scheme === "exact" && r.network in ALL_NETWORKS && allowed.has(r.network as X402Network),
  );
  if (!requirement) {
    const allowedList = [...allowed].join(", ");
    throw new X402Error(
      "UNSUPPORTED_SCHEME",
      `Seller did not offer exact USDC on an allowed network (${allowedList}).`,
    );
  }
  const network = requirement.network as X402Network;
  if (requirement.asset.toLowerCase() !== ALL_NETWORKS[network].asset) {
    throw new X402Error(
      "UNSUPPORTED_SCHEME",
      `Seller requested unsupported asset ${requirement.asset}.`,
    );
  }
  if (!isAddress(requirement.payTo)) {
    throw new X402Error("SELLER_REJECTED", `Malformed payTo address: ${requirement.payTo}`);
  }
  if (blocklist.some((x) => x.toLowerCase() === requirement.payTo.toLowerCase())) {
    throw new X402Error(
      "SELLER_REJECTED",
      `Seller payout address is blocklisted: ${requirement.payTo}`,
    );
  }
  let priceMicro: bigint;
  try {
    priceMicro = BigInt(requirement.amount);
  } catch {
    throw new X402Error("SELLER_REJECTED", `Malformed price: ${requirement.amount}`);
  }
  if (priceMicro <= 0n)
    throw new X402Error("SELLER_REJECTED", "Seller quoted a non-positive price.");
  if (priceMicro > authorizedMicro) {
    throw new X402Error(
      "PRICE_EXCEEDS_AUTHORIZED",
      `Seller price ${priceMicro} exceeds authorized ${authorizedMicro}`,
    );
  }
  return { requirement, priceMicro, network };
}

async function readBody(response: Response): Promise<unknown> {
  return response.headers.get("content-type")?.includes("application/json")
    ? response.json()
    : response.text();
}

function extractAuthNonce(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const root = payload as Record<string, unknown>;
  const nested = root.payload;
  const candidates = [
    root,
    nested && typeof nested === "object" ? (nested as Record<string, unknown>) : null,
  ];
  for (const obj of candidates) {
    if (!obj) continue;
    const auth = obj.authorization ?? obj.authorizations;
    if (auth && typeof auth === "object") {
      const nonce = (auth as Record<string, unknown>).nonce;
      if (typeof nonce === "string" && nonce) return nonce;
    }
    if (typeof obj.nonce === "string" && obj.nonce) return obj.nonce;
  }
  return undefined;
}

export async function payViaX402(args: {
  url: string;
  authorizedMicro: MicroUsdc;
  orgId: string;
  blocklist?: string[];
  fetchImpl?: typeof fetch;
  /**
   * Called after the EIP-3009 authorization is signed and before it is sent to
   * the seller. The marker must be persisted so a later seller/network failure
   * is treated as needs_review rather than a clean failure that releases the hold.
   */
  onAuthorizationSigned?: (
    marker: string,
    details: { nonce?: string; validBefore?: string },
  ) => void;
}): Promise<{ receipt: X402Receipt; resource: unknown; contentType: string | null }> {
  const problem = outboundUrlProblem(args.url, "Payment destination");
  if (problem) throw new X402Error("INVALID_DESTINATION", problem);

  // DNS pin on the real network path only. Injected fetchImpl is for tests and
  // already controls what is reached; resolving seller.example (etc.) would
  // fail the suite for an unrelated reason.
  if (!args.fetchImpl) {
    const pinned = await resolveAndPinOutboundUrl(args.url, "Payment destination");
    if (!pinned.ok) throw new X402Error("INVALID_DESTINATION", pinned.problem);
  }

  const custody = getCustodyProvider();
  const wallet = await custody.getAddress(args.orgId);
  if (!wallet) throw new X402Error("CUSTODY_UNAVAILABLE", "Organization has no custody address.");
  const doFetch = args.fetchImpl ?? fetch;
  const first = await doFetch(args.url, { signal: AbortSignal.timeout(10_000), redirect: "error" });
  if (first.status !== 402) {
    if (first.ok)
      throw new X402Error("NO_PAYMENT_REQUIRED", "Resource did not request payment (HTTP 200)");
    throw new X402Error("RAIL_FAILED", `Seller returned HTTP ${first.status}`);
  }

  const challengeBody = await readBody(first);
  let paymentRequired: PaymentRequired;
  try {
    paymentRequired = new x402HTTPClient(new x402Client()).getPaymentRequiredResponse(
      (name) => first.headers.get(name),
      challengeBody,
    );
  } catch (error) {
    throw new X402Error(
      "SELLER_REJECTED",
      `Invalid x402 challenge: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const selected = selectRequirement(paymentRequired, args.authorizedMicro, args.blocklist ?? []);
  const signer: ClientEvmSigner = {
    address: wallet.address,
    signTypedData: (typedData) => custody.signTypedData({ orgId: args.orgId, typedData }),
  };
  // Defence in depth: SDK spend controls capped at the ABI-authorized amount.
  const core = new x402Client((_version, requirements) => requirements[0])
    .register(selected.network, new ExactEvmScheme(signer))
    .setSpendControls({
      maxAmountPerPayment: false,
      allowedAssets: [
        {
          network: selected.network,
          asset: selected.requirement.asset,
          maxAmountPerPayment: args.authorizedMicro.toString(),
        },
      ],
    });
  const http = new x402HTTPClient(core);
  const payload = await http.createPaymentPayload({
    ...paymentRequired,
    accepts: [selected.requirement],
  });
  const nonce =
    extractAuthNonce(payload) ??
    `anon-${createHash("sha256").update(randomBytes(16)).digest("hex").slice(0, 16)}`;
  // Irreversible: the seller can settle this signed authorization on-chain even
  // if the HTTP response is non-2xx or the PAYMENT-RESPONSE is malformed.
  args.onAuthorizationSigned?.(`x402-auth:${nonce}`, { nonce });
  const paid = await doFetch(args.url, {
    headers: http.encodePaymentSignatureHeader(payload),
    signal: AbortSignal.timeout(30_000),
    redirect: "error",
  });
  if (!paid.ok) {
    const body = await paid.text().catch(() => "");
    throw new X402Error("SELLER_REJECTED", `Seller rejected payment: HTTP ${paid.status} ${body}`);
  }

  let settlement;
  try {
    settlement = http.getPaymentSettleResponse((name) => paid.headers.get(name));
  } catch (error) {
    throw new X402Error(
      "RAIL_FAILED",
      `Missing or invalid PAYMENT-RESPONSE: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!settlement.success || !isTxHash(settlement.transaction)) {
    throw new X402Error(
      "RAIL_FAILED",
      settlement.errorMessage ??
        settlement.errorReason ??
        "Facilitator did not confirm settlement.",
    );
  }
  const chargedMicro = BigInt(settlement.amount ?? selected.priceMicro.toString());
  if (chargedMicro <= 0n || chargedMicro > args.authorizedMicro) {
    throw new X402Error(
      "RAIL_FAILED",
      `Facilitator reported invalid settled amount ${chargedMicro}.`,
    );
  }
  const contentType = paid.headers.get("content-type");
  const resource = await readBody(paid);
  return {
    receipt: {
      amountMicro: chargedMicro,
      network: selected.network,
      payer: settlement.payer && isAddress(settlement.payer) ? settlement.payer : wallet.address,
      payTo: selected.requirement.payTo as `0x${string}`,
      txHash: settlement.transaction,
      settled: true,
      authorizationNonce: nonce,
    },
    resource,
    contentType,
  };
}

export class X402Rail implements PaymentRail {
  readonly name = "x402-v2";

  async settle(ctx: PaymentRailContext): Promise<PaymentRailResult> {
    if (!/^https?:\/\//i.test(ctx.destination)) {
      throw new X402Error("RAIL_FAILED", "x402 rail requires an http(s) destination URL");
    }
    const paid = await payViaX402({
      url: ctx.destination,
      authorizedMicro: ctx.authorizedMicro,
      orgId: ctx.orgId,
      blocklist: ctx.blocklist,
      onAuthorizationSigned: (marker) => {
        // Persist before the seller sees the signature — this is the
        // signed-but-unrecorded-spend guard.
        ctx.onBroadcast?.(this.name, marker);
      },
    });
    // Upgrade the broadcast marker to the real facilitator transaction hash.
    ctx.onBroadcast?.(this.name, paid.receipt.txHash);
    return {
      chargedMicro: paid.receipt.amountMicro,
      rail: this.name,
      txHash: paid.receipt.txHash,
      resource: paid.resource,
      contentType: paid.contentType,
      settled: true,
    };
  }
}
