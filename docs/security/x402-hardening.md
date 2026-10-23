# x402 hardening (2026-10-23)

## Server side — paid routes answer only their paid method

`@x402/core` ≤ 2.28.0 (we ship 2.26.0) matches routes by exact verb, so
`HEAD /report` does not match the `"GET /report"` paywall. Express runs the GET
handler for HEAD and drops the body: the paid work runs unpaid. Upstream fixed
this in x402 PR #3796 (merged 2026-10-13, **not in any release yet**); that fix
in turn lets a HEAD carrying a payment settle with no body (x402 issue #3810).

ABI's only x402 server is `apps/x402-seller`. It now mounts
`paidMethodGuard` before the payment middleware: any method other than the
configured one on a paid path gets `405` with `Allow: GET`, before the paywall
or the handler runs. The ABI API itself serves no paid routes (merchant gateway
onboarding only *reads* a seller's challenge).

When an `@x402/*` release ships #3796, unpack it and grep for the fix before
relying on it; the guard can stay either way.

## Header budget

- Seller: refuses to boot if its `PAYMENT-REQUIRED` header would exceed 4 KB
  (`MAX_PAYMENT_HEADER_BYTES`); today it is ~0.5 KB.
- Buyer (`apps/api/src/rails/x402.ts`): refuses a `PAYMENT-REQUIRED` header, or
  its own `PAYMENT-SIGNATURE`, over 8 KB (`x402_header_too_large`).

## Buyer — check before signing

Before ABI signs an EIP-3009 authorization for `pay_api`, the seller's challenge
must match the approved intent:

| Check | Rule id |
| --- | --- |
| amount ≤ approved amount (and ≤ registered price for onboarded merchants) | `x402_amount_exceeds_approved` |
| USDC on an allowed network (pinned to `CHAIN`, or `ABI_X402_NETWORKS`) | `x402_unsupported_asset_or_network` |
| payTo = the payout address registered for that merchant gateway | `x402_payee_mismatch` |
| network = the network registered for that merchant gateway | `x402_network_mismatch` |
| the signed authorization's `to` / `value` / network / asset / `from` equal what was selected | `x402_signed_payload_mismatch` |

A guard refusal returns HTTP 403 with `outcome: "deny"` and the rule id. Ad-hoc
URLs (not onboarded) have no registered payee, so only the amount, asset,
network and blocklist checks apply — onboard the merchant to pin its payee.
