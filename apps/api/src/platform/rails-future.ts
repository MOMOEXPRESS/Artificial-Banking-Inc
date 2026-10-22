/**
 * Free stubs for future payment rails and agent-identity protocols.
 *
 * These exist so product recommendations (AP2 mandates, Stripe SPT/MPP,
 * Circle nanopayments, L402, Visa Trusted Agent) have an in-repo seam without
 * pulling paid SDKs or requiring API keys. Implementations should replace the
 * throw paths when a free test environment is available.
 */
import type { PaymentRail, PaymentRailContext, PaymentRailResult } from "../rails/types.js";

export type Ap2MandateKind = "intent" | "cart" | "payment";

export interface Ap2Mandate {
  kind: Ap2MandateKind;
  /** Opaque verifiable-credential style payload — not validated here. */
  credential: Record<string, unknown>;
}

/** Map an AP2 mandate onto ABI policy inputs (amount / destination / agent). */
export function ap2MandateToPolicyHints(mandate: Ap2Mandate): {
  amountUsdc?: string;
  destination?: string;
  agentId?: string;
} {
  const c = mandate.credential;
  return {
    amountUsdc: typeof c.amountUsdc === "string" ? c.amountUsdc : undefined,
    destination: typeof c.destination === "string" ? c.destination : undefined,
    agentId: typeof c.agentId === "string" ? c.agentId : undefined,
  };
}

export class StripeSptRailStub implements PaymentRail {
  readonly name = "stripe-spt-stub";
  async settle(_ctx: PaymentRailContext): Promise<PaymentRailResult> {
    throw new Error(
      "Stripe SPT/MPP rail is not configured. Free path: keep x402/Base Sepolia; " +
        "add Stripe test keys later (no live charges until then).",
    );
  }
}

export class CircleNanopaymentsRailStub implements PaymentRail {
  readonly name = "circle-nanopayments-stub";
  async settle(_ctx: PaymentRailContext): Promise<PaymentRailResult> {
    throw new Error(
      "Circle Nanopayments is not configured. Free path: batch small x402 payments " +
        "under the existing authorizedMicro ceiling.",
    );
  }
}

export class L402RailStub implements PaymentRail {
  readonly name = "l402-stub";
  async settle(_ctx: PaymentRailContext): Promise<PaymentRailResult> {
    throw new Error(
      "L402/Lightning rail is not configured. Requires a Lightning node (self-hostable OSS) " +
        "before this stub can settle invoices.",
    );
  }
}

/** Visa Trusted Agent / Web Bot Auth style signature verification — stub. */
export function verifyTrustedAgentSignature(_args: {
  signature: string;
  body: string;
  headers: Record<string, string>;
}): { ok: false; reason: string } {
  return {
    ok: false,
    reason:
      "Trusted Agent Protocol verification is not implemented. Free path: attach " +
      "agentId + policy decision ids on receipts (already done) until a public test vector exists.",
  };
}
