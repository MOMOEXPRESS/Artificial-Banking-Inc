/**
 * Free stubs for future payment rails and agent-identity protocols.
 *
 * These exist so product recommendations (AP2 mandates, Stripe SPT/MPP,
 * Circle nanopayments, L402, Visa Trusted Agent) have an in-repo seam without
 * pulling paid SDKs or requiring API keys. Implementations should replace the
 * throw paths when a free test environment is available.
 *
 * None of these is x401. ABI's x401 identity verifier lives in
 * ../identity/x401 and is wired into the hosted checkout explicitly.
 */
import type { PaymentRail, PaymentRailContext, PaymentRailResult } from "../rails/types.js";

export type Ap2MandateKind = "intent" | "cart" | "payment";

export interface Ap2Mandate {
  kind: Ap2MandateKind;
  /** Opaque verifiable-credential style payload — not validated here. */
  credential: Record<string, unknown>;
}

/**
 * Read AP2 mandate fields as UNVERIFIED hints (e.g. to prefill a form).
 * This parses fields only; it does not verify any signature, so the result is
 * marked `verified: false` and must never authorize spending, identify an
 * agent, or feed a policy decision. See verifyAp2Mandate.
 */
export function ap2MandateToPolicyHints(mandate: Ap2Mandate): {
  verified: false;
  amountUsdc?: string;
  destination?: string;
  agentId?: string;
} {
  const c = mandate.credential;
  return {
    verified: false,
    amountUsdc: typeof c.amountUsdc === "string" ? c.amountUsdc : undefined,
    destination: typeof c.destination === "string" ? c.destination : undefined,
    agentId: typeof c.agentId === "string" ? c.agentId : undefined,
  };
}


/**
 * AP2 mandate verification is not implemented, so every mandate is refused
 * (fail closed). A real implementation must verify the mandate's signature
 * chain per the AP2 specification before any field is trusted.
 */
export function verifyAp2Mandate(_mandate: Ap2Mandate): { ok: false; reason: string } {
  return {
    ok: false,
    reason: "AP2 mandate signature verification is not implemented; mandates are not accepted.",
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

/**
 * Visa Trusted Agent / Web Bot Auth signature verification: NOT implemented.
 * Always fails closed; callers must treat the request as unauthenticated.
 */
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
