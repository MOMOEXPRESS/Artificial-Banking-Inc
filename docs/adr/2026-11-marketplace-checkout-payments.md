# ADR-004: Cart pre-flight, approvals, agent-driven pay, escrow default

**Status:** Accepted (M0)  
**Date:** 2026-11-06  
**Context:** Policy, session budget, and approvals are per payment intent. Hosted x402 settles straight to the seller payout address. Intra-org ledger escrows cannot hold cross-org buyer→vendor funds.

## Decision

1. **Pre-flight** the whole cart (simulate each vendor payment, sum budgets/compliance) before any reservation or payment.
2. **Cart-level approval** when any line needs HITL or cart total exceeds effective `hitlAboveMicro`; per-line `pay_api` still goes through normal policy afterward.
3. Marketplace **never signs or sends money**. Checkout returns per-vendor `{ payUrl, amountUsdc, idempotencyKey }`; the buyer agent pays via `/v1/agent/pay_api` (or MCP / one-shot subscriptions).
4. Payment URLs are **ABI-hosted ephemeral offers** created with existing `store.createOffer` (payee = vendor in direct mode, marketplace escrow org in escrow mode).
5. Multi-vendor carts default to **escrow mode** (M7). Fees: `marketplace_fee_bps` default 0 — do not collect fees in this project.
6. Reconcile job advances `order_payments` from `settlement_attempts` / `seller_settlements`.

## Consequences

- Money-layer files stay frozen; integration is call-only (Area 7).
- Open question: merchant daily caps keyed by ABI host → handle per-vendor in pre-flight without changing `packages/policy`.
