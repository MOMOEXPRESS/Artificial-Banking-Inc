# ADR-003: Marketplace auth (roles, scopes, public projection)

**Status:** Accepted (M0)  
**Date:** 2026-11-06

## Decision

1. Keep `guardianRoute` (buyer humans), `authAgent` (buyer agents), `partnerRoute` (vendor humans). Add `vendorRoute` in `marketplace/auth.ts` on top of `partnerRoute` with `partner_roles` (`owner | catalog_manager | fulfilment | finance | viewer`).
2. Agent marketplace scopes: `market:read`, `market:cart`, `market:checkout`. Full `pv_agent_` keys get all three via a marketplace helper — **do not edit `authAgent`**. Session keys must list scopes explicitly. Checkout also needs existing `pay`.
3. Public `/v1/market/*` responses go through `marketplaceStore.publicProductView` whitelist only; unpublished / inactive-vendor rows are omitted. Cross-tenant miss → **404**, never 403.
4. Shared records (orders, disputes, escrow holds) use two-party getters with side-specific projections.

## Consequences

- Partner role backfill: every existing partner account → `owner` (M2).
- Session-key validator enum extended additively (M1/M4).
