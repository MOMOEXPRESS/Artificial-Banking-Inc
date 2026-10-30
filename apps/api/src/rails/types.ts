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
  /** x402 only: payee / network / price pinned by the approved intent. */
  x402Expect?: { payTo?: string; network?: string; maxAmountMicro?: bigint };
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
  /**
   * Called with exactly what was signed, BEFORE it leaves the process
   * (reserve the signed maximum). Throwing here aborts the payment while
   * nothing has been sent. `authorization` is set for EIP-3009 (x402).
   */
  onSigned?: (signedMaxMicro: MicroUsdc, authorization?: SignedAuthorizationDetails) => void;
}

/** What an EIP-3009 authorization commits the vault to, for later recheck. */
export interface SignedAuthorizationDetails {
  nonce: string;
  /** Unix seconds; after this the authorization can never be claimed. */
  validBefore?: string;
  payer?: string;
  payTo?: string;
  asset?: string;
  network?: string;
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
