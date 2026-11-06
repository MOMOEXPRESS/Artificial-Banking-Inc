# ADR-005: Vendor KYC reuse and tier caps

**Status:** Accepted (M0)  
**Date:** 2026-11-06  
**Context:** Seller orgs cannot submit KYC today; payout addresses are not ownership-proven; no sales caps on vendors.

## Decision

- Reuse `org_kyc` + `evaluateKyc` via partner routes `/v1/seller/compliance*`. No third-party identity/sanctions providers.
- `vendors.tier`: `unverified | basic | verified | restricted` with caps from the brief (env-overridable in `marketplace/config.ts`).
- Payout proof: EIP-191 `personal_sign` via `viem` `verifyMessage` (free, no gas). Proven address written through existing seller profile update path so `seller_profiles.payout_address` never diverges from `vendors.payout_address`.
- Domain proof: existing `seller-ownership.ts` helpers.
- Pure `vendorTier()` with unit tests; recompute on events + nightly job.

## Consequences

- Unverified vendors can draft but not publish (M2).
- UI copy must say self-attested / ABI rules / not regulated identity verification.
