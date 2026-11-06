# Marketplace modules

Commerce layer on top of ABI’s financial OS. Flag-gated: `ABI_MARKETPLACE=1` (API) and `NEXT_PUBLIC_ABI_MARKETPLACE=1` (web). Both default **off**.

## Boundaries

- May import: `../store.js` getters, `marketplaceDb()`, `../kyc-kya.js`, `../webhooks.js` (`emitEvent`), `../platform/observability.js`, `../seller-x402.js` **exports only**, `@policyvault/common`.
- Must **not** import: `@policyvault/ledger`, `@policyvault/custody`, `../rails/*`, `../chain/*`, or call `store.applyEntries`.
- Money movement stays on `/v1/agent/pay`, `/v1/agent/pay_api`, hosted x402, and existing escrow-releaser `pay` intents (M7). See `docs/marketplace/AUDIT.md` and Area 7.

## Layout

See Part 6 of the marketplace brief. M0 lands this README, `marketplaceDb()` consumers (tests), and guard tests only. Feature modules arrive in M1+.

## Tests

```bash
env -u RESEND_API_KEY -u BREVO_API_KEY npm test --workspace=@policyvault/api -- marketplace
```
