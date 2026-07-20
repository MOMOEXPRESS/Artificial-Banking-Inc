/**
 * Payment rail interface — every settlement path (x402, transfer-mock, future
 * ACH/card/batch) implements this so `executeIntent` never forks per product.
 */
import type { MicroUsdc } from "@policyvault/common";

export interface PaymentRailContext {
  orgId: string;
  agentId: string;
  intentId: string;
  destination: string;
  authorizedMicro: MicroUsdc;
  blocklist?: string[];
}

export interface PaymentRailResult {
  /** Amount actually charged (may be less than authorized for x402). */
  chargedMicro: MicroUsdc;
  rail: string;
  txHash?: string;
  resource?: unknown;
  contentType?: string | null;
  settled: boolean;
}

export interface PaymentRail {
  readonly name: string;
  settle(ctx: PaymentRailContext): Promise<PaymentRailResult>;
}
