# Card-funded credits

Card funding is a new, separate USD account. It does not mint USDC, increase an agent allowance, or pay existing x402/marketplace orders. Existing wallet, ledger, x402 and stablecoin settlement remain unchanged. The current settlement deployment uses Base Sepolia.

The production default is disabled. Do not enable real-money collection until the operator has defined what USD credits purchase, cancellation/refund terms and any separately implemented conversion/liquidity arrangement. A provider credential alone does not establish those capabilities. No card-funded credit consumption or fiat-to-USDC conversion is implemented in this change.

## Configuration

On the existing ABI API Worker, configure `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` as secrets. Set `ABI_CONSOLE_URL` to the HTTPS console origin (no path). Set `ABI_CARD_FUNDING_ENABLED=1` only after the readiness conditions above are met. Never put Stripe secrets in Next.js public variables or source control. Start with Stripe test mode.

Register the API origin `/v1/billing/webhook` in Stripe for:

- `checkout.session.completed` and `checkout.session.expired`
- `payment_intent.succeeded` and `payment_intent.payment_failed`
- `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`

Use separate test and live webhook secrets. The endpoint verifies the exact raw body, timestamp and HMAC before applying an event. Checkout redirects do not credit funds. Hosted Stripe Checkout collects card details; ABI stores only the provider token and display label.

## Contracts

- `GET /v1/guardian/billing`: tenant-scoped USD balance, availability, settings, payment-method label and funding activity.
- `POST /v1/guardian/billing/checkout`: owner and CSRF protected; integer `amountCents` ($5–$1,000), stable `requestKey`.
- `POST /v1/guardian/billing/payment-method`: owner and CSRF protected; stable `requestKey`; hosted SetupIntent verification.
- `PUT /v1/guardian/billing/auto-topup`: explicit `enabled`, `thresholdCents`, `amountCents`, `monthlyCapCents`. Owner only; verified card required for enabling.

Funding intents and the signed credit journal persist in the existing SQLite Durable Object. Event IDs and intent credit state prevent duplicate credits. Refunds use cumulative bounded reversals; out-of-order reversal events are retained until their payment is credited. Saving a newer card prevents an older setup session from replacing it later.

Auto top-up runs through the existing Cloudflare alarm runner. It reserves a pending intent atomically before charging, includes pending attempts in the calendar-month cap, and permits one unresolved automatic charge per workspace. A 10-minute cooldown limits submissions. Failure or required authentication disables automatic charging.

Unknown transport outcomes deliberately retain their pending reservation. The operator must reconcile the stored funding ID and Stripe idempotency key (`abi-auto:<funding-id>`) against Stripe and replay the verified provider webhook. Do not delete pending rows or create replacement charges to resolve ambiguity. There is no manual reconciliation UI in this release. On standalone Node deployments the Cloudflare alarm runner is not present; an operator scheduler must invoke the same funding job.

The console disables card funding until server readiness is true. Stablecoin balances are displayed separately; a USD credit is never labeled spendable USDC.
