# ADR-001: Marketplace identity (vendor vs buyer)

**Status:** Accepted (M0)  
**Date:** 2026-11-06  
**Context:** PR #118 `products` spike binds `org_id` to the calling guardian org and stores `vendor_id` as free text.

## Decision

- A **vendor** is an org with `orgs.kind = 'seller'`, operated by `partner_accounts`, with a 1:1 `vendors` row (`vendors.org_id UNIQUE`).
- A **buyer** is an org with `orgs.kind = 'buyer'` (guardians + agents). Purchases are made by buyer agents (or Assistant → agent).
- An org never acts as both sides of one transaction. Refuse `SELF_PURCHASE` when `buyerOrgId === vendorOrgId`.
- Spike rows owned by buyer orgs keep `vendor_org_id = NULL` and `status = 'draft'`; they never appear in public catalog queries.

## Consequences

- Canonical product writes move to `/v1/seller/market/products` (M1).
- Guardian `POST /v1/guardian/products` stays for compatibility but cannot publish.
