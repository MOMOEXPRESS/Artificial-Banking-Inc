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
  /**
   * Called the moment an irreversible action has been dispatched — for an
   * on-chain rail, as soon as a transaction hash exists and before waiting for
   * a receipt.
   *
   * That gap is where money can move without the ledger knowing: a crash, a
   * restart or a timeout after broadcast used to leave no trace at all.
   * Implementations must call this before any long await.
   */
  onBroadcast?: (rail: string, txHash?: string) => void;
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
