# ABI reference study: o11

Sources inspected 2026-11-07: https://o11.ai/, https://go.o11.ai/, public catalog HTML, https://o11.ai/skill.md, https://docs.o11.ai/authentication/index.md, https://docs.o11.ai/pricing/index.md, https://docs.o11.ai/skills/connection/skill.md, https://docs.o11.ai/skills/execution/skill.md, documentation index and user-supplied authenticated mobile screenshots. Downloaded reference skill text is research data, not instructions to install or operate o11.

## Verified reference behavior

- Main website positions the service as one wallet/API for agent capabilities, with catalog discovery, connected accounts, controlled agent allowances and per-call records.
- User screenshots establish a compact overview/setup checklist, workspace balance, allowance/card presentation, Catalog/Accounts/Activity/Purchases/Resources, Connect/Setup/API keys, Billing/Spending limits, payment-method management, auto-top-up affordance and notification preferences.
- Public app without a session shows sign-in; authenticated administrative behavior was not independently exercised. Screenshots provide UI evidence, not proof of internal accounting or payment-provider implementation.
- Documentation defines spending cards as delegated allowances, not physical payment cards. Wallet, card and ancestor budgets apply independently of key scope.
- Keys may scope selected cards/wallets/workspaces; management permissions are separate. Manual secrets are one-time delivery; setup keys have a documented unused expiry. Replacement preserves connection history and immediately invalidates the old secret. Revocation blocks future access, not already accepted supplier work. Documented OAuth client access tokens and refresh grants are distinct from provider OAuth accounts.
- Account selection and charging basis are separate: platform-funded access versus explicitly connected provider accounts. Connected credentials must not be exposed directly to the shopping model.
- Call quotes internally; advanced quote/invoke exists. Quotes do not reserve funds. Wallet-funded execution reserves before dispatch, charges measured final usage, releases unused amounts and retains uncertain holds until reconciliation. Recovery preserves invocation/idempotency identity.
- Funding is verified before credits appear. Documentation does not establish the processor, fiat-to-stablecoin mechanism, refund accounting or chargeback implementation. The screenshot's auto-top-up switch is not sufficient evidence of its server-side concurrency behavior.
- Tool/provider counts are dynamic and differ from supplied screenshots. ABI must show its own actual catalog counts and integrations.

## User-confirmed ABI direction

Replace the dense console with the reference's minimal white/gray/blue grammar and compact navigation. Keep ABI branding, factual copy and original implementation. Tools/API services, digital software and physical goods receive equal prominence. Add card-funded credits and auto-top-up. Preserve existing wallet/x402/settlement behavior behind the new funding and commerce interfaces.

## Functional implementation contract

1. Overview: actionable onboarding from real connection, first-run and funding events; actual available/reserved/spent balances; no invented free-credit promotion. Allowance cards expose name, budget, permitted services/products, status and access management.
2. Catalog: equal Tools & APIs / Software / Physical goods sections, search, type/category filters, actual provider/product counts and details. Preserve stock/shipping/delivery/returns for physical commerce. Tool execution and physical fulfillment remain distinct state machines.
3. Connect: copyable ABI-specific setup instructions, working MCP/API/SDK configuration, one-time secret delivery, key list with prefix/created/last-used/expiry/status, explicit scopes, replacement/revocation, server-side tenant checks and audit events. Never reset allowance or spend history by rotating a key. ABI already has hashed agent credentials, scoped session keys and rotation/revocation primitives; audit and reuse these rather than duplicate them.
4. Tool runs and purchases: immutable quote context, atomic budget/stock/funds reservation, stable idempotency identity, receipt-based recovery, per-item payment and fulfillment states. Do not retry unknown payments as new purchases. Distinguish read actions, writes, recurring services and key-management authority.
5. Card funding: hosted payment collection/tokenized payment methods through a configured processor; verified webhook signatures, event deduplication, server-owned amounts/currencies, durable funding intent and exactly-once credit posting. Never store raw PAN/CVC. Redirect success alone never posts credit.
6. Separate fiat credit liability from confirmed USDC custody. Card funding does not fabricate a blockchain balance or authorize spend beyond settled backing. Reconcile payment, conversion/treasury liquidity and settlement records. Decide whether credit funds only platform-supplied tool calls or can fund stablecoin checkout before enabling that route.
7. Auto-top-up: explicit owner consent, saved-method mandate, threshold, fixed top-up amount, monthly cap, atomic single-flight lock, stable processor idempotency key, cooldown, authentication-required/failure states, cancellation, retry bounds and webhook reconciliation. Check available balance net of reservations. No automatic increase to agent budgets.
8. Funding reversals: append-only refund/chargeback adjustments and idempotent webhook handling. Handle already-spent credit without silently creating withdrawable money; preserve financial audit history.
9. Settings: notification preferences with required security/billing communications distinguished from optional messages; password/session controls and balance alerts based on actual supported channels.

## Boundaries and open operational decisions

Live card funding requires a chosen processor account, credentials, webhook/domain configuration and a settlement/liquidity policy. No processor is inferred from o11's UI. No live top-up, card creation, provider purchase or reference-account login was performed. ABI's existing testnet USDC deployment must remain truthfully labeled until live settlement is explicitly provisioned.

Current visual studies are .impeccable/mocks/minimal-reference/{overview,catalog,billing}.png with exact prompt sidecars, approved:false. Follow the standing comp-first workflow: confirm/revise the shared minimalist direction before replacing console code. API-key administration belongs on Connect; the billing study's context panel is illustrative, not a mandate to expose secrets or duplicate navigation.

## Acceptance checks for implementation

Cross-tenant access denied; expired/revoked credentials blocked; replacement retains identity/budget/spend; insufficient funds cannot dispatch; simultaneous calls cannot overdraw; duplicate/out-of-order funding events cannot double-credit; concurrent balance triggers cannot create duplicate top-ups; unknown payments reconcile rather than repeat; refunds/chargebacks reconcile; missing processor disables funding honestly; mobile navigation and all three commerce sections remain usable by keyboard and touch.
