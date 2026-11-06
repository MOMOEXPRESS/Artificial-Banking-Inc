# ADR-002: Products-over-offers catalog

**Status:** Accepted (M0)  
**Date:** 2026-11-06  
**Context:** ABI has x402 `offers` (seller APIs) and a `products` spike. Discovery must not maintain two incompatible shapes forever.

## Decision

- Discovery and the public marketplace catalog search **`products` only**.
- A product with `kind = 'api'` links to an `offers` row via `products.offer_id`. The offer remains the x402 payable resource; the product is the rich catalog entry.
- Job `marketplace-offer-sync` (M1) creates one published catalog product per published, directory-listed offer.
- `GET /v1/directory/offers` stays unchanged for backward compatibility.

## Consequences

- Price fields: catalog uses `price_micro` / `price_micro_int`; offers keep `price_usdc_micro`.
- Ephemeral checkout payment offers are tagged `marketplace_payment_id` and excluded from seller lists / directory (M4).
