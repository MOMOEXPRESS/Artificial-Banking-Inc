# Testnet agent payments preview — 19 November 2026

This release makes the preview funding and execution path use the same account execution treasury. It supersedes the earlier mainnet/Privy funding UI for preview accounts. It does not migrate, sweep or delete any existing Privy wallet or asset.

## Supported loop

1. In buyer Billing, select **Add test funds**. Send official test USDC on **Base Sepolia (84532)** to the verified execution treasury address. Circle's faucet supports this network. ETH is needed by the settlement submitter for gas; a USDC transfer on Ethereum Sepolia does not fund Base Sepolia.
2. **Check deposits** scans the existing on-chain deposit path. Only confirmed matching transfers credit the account ledger, with event deduplication. No balance is fabricated by opening the UI or pressing refresh.
3. Allocate from **Account treasury** (the default General ledger account) to a workspace. Allocations move ledger balances within one treasury, not tokens between wallets. Existing approval requirements and idempotency apply. Cross-workspace allocations remain available.
4. A workspace-scoped agent calls `POST /v1/agent/pay_api` using the existing API contract, an allowlisted endpoint, amount ceiling and stable idempotency key. Existing workspace authorization, freeze, budget, daily/weekly/monthly limits, seller policy and approval checks still apply.
5. For x402, an HTTP 402 `PAYMENT-REQUIRED` challenge is answered with `PAYMENT-SIGNATURE`; successful settlement returns `PAYMENT-RESPONSE`. For MPP EVM charge, `WWW-Authenticate: Payment ...` is answered with `Authorization: Payment ...` (or the supported requested `Payment-Authorization` header), then `Payment-Receipt` confirms settlement.
6. The seller verifies and settles through the configured facilitator, returns paid content and records its sale. The buyer commits the actual charge and releases unused reserved capacity. Unknown outcomes retain the hold for reconciliation rather than paying again.

## Seller endpoints and scope

Published ABI-hosted offers retain `/v1/x402/offers/:offerId`. That endpoint also advertises an MPP challenge when configured. `/v1/mpp/offers/:offerId` selects MPP for the same offer, seller policy and payout destination. MPP aliases resolve to the canonical offer before buyer policy checks.

Current MPP scope is **EVM charge, GET resources, native USDC on Base Sepolia, EIP-3009 authorization**. It does not implement Tempo sessions, card payments, subscriptions, arbitrary currencies, splits or mainnet payments. Challenge HMACs bind the resource and current offer terms; expiry and nonce checks precede facilitator verification. The SDK is `mppx@0.21.0`; its framework-independent wire/client modules are used. The root optional Express peer override retains ABI's Express 4 API; no `mppx/express` adapter is imported.

`ABI_PREVIEW_TESTNET=1` requires `CHAIN=base-sepolia` and restricts negotiated agent payments and hosted offers to that network regardless of a mainnet allowlist. Normal preview funding only shows test USDC. Existing mainnet recovery/read APIs remain for previously created assets; they do not fund this preview's ledger.

## Verification and remaining live proof

Automated integration tests use actual Express HTTP requests and custody EIP-712 signatures. Deposit events, facilitator settlement responses and chain confirmations are fixtures: **these tests are not evidence of a newly funded on-chain transaction**. They cover both buyer/seller protocols, duplicate deposit/allocation/payment prevention, paid content, seller accounting, modified challenges, frozen workspaces, paused sellers, mainnet refusal and unknown-outcome holds. Existing API regressions cover the shared policy/approval/limit paths. The Prisma consistency mirror was regenerated from the existing runtime schema, including seven previously omitted workspace tables; this is not a production database migration.

Browser checks at desktop and mobile sizes exercise the actual preview deposit QR, network label, no-new-deposit refresh, allocation request and feedback. Worker local-runtime verification and build checks exercise the deploy target.

Before calling the current revision **live end-to-end proven**, use a signed-in owner test account and scoped agent credentials through secure UI/session access:

- fund the displayed Base Sepolia treasury with a small amount of test USDC;
- confirm the deposit transaction/event and exact ledger credit, then retry sync to verify no duplicate;
- allocate to a test workspace and confirm the total treasury ledger remains conserved;
- publish a hosted test offer with a valid seller payout and allowed buyer identity;
- purchase once through each protocol and verify paid content, real transaction receipts, seller payout and matching buyer ledger charges;
- repeat each idempotency key and confirm no new settlement;
- exercise an over-budget/refused purchase and confirm no funds move;
- inspect pending/unknown outcomes and reconciliation without sending a replacement payment.

The previously connected ABI Sandbox points at a retired Render endpoint (404). Reconnect it to the current deployment or use a signed-in shared-browser account to complete this proof. Do not paste private keys or API keys into chat. The historical September x402 proof is documented separately and does not prove this revision or MPP.

Protocol references: https://mpp.dev/payment-methods/evm, https://mpp.dev/protocol, https://github.com/wevm/mppx, https://github.com/x402-foundation/x402.
