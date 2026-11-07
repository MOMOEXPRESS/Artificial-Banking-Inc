# ABI hybrid coverage

Current authority: .impeccable/briefs/abi-o11-hybrid.md, the approved .impeccable/mocks/abi-o11-hybrid/overview-study.png and source-extracted DESIGN.md/.impeccable/design.json. User steering selected the original ABI vault/card with o11 typography, materials and placement, and authorized production deployment. Authorization is not release evidence. Previous minimal-reference, navy-rail and beige/green directions are superseded.

## Shared system
Self-hosted official Inter variable under SIL OFL replaces IBM Plex body typography; IBM Plex Mono remains for code. Use #fafafa canvas, #262626 ink, #525252 secondary, opaque #f4f4f4 content and #e5e5e5 inputs with restrained blue actions. Glass is reserved for navigation, menus and the original ABI card. The desktop header and floating five-destination dock share navigation; at 760px desktop links hide and the dock contracts. Preserve focus, native semantics, reduced motion/transparency, loading/empty/error/unavailable states and authentication/policy contracts. The interface is pinned light and the nonfunctional Theme menu is removed.

## Public routes
| Route | Coverage / truth |
| --- | --- |
| / | Existing homepage structure retained; shared Inter typography and glass navigation adapted; equal Tools & APIs / Software / Physical goods, real catalog component and seller invitation |
| /directory, /products/[id] | Source-backed discovery/details, actual listing availability and capability boundaries |
| /about, /partnerships, /pricing | Shared public chrome and factual marketplace/seller/availability messaging |
| /docs | Accurate buyer/seller/developer workflows and technical contracts |
| /waitlist, /partners/login, /console/signup | Preserve submission and distinct seller/buyer authentication; seller login receives current neutral styling |
| /approvals | Preserve verification and approval semantics |
| /terms, /privacy, /cookies | Readable legal content and factual entity naming |
| error, global-error, not-found | Existing recovery paths; coverage requires route-specific evidence |

Shared CSS does not establish a separately redesigned or browser-verified composition for every public route.

## Buyer workspace
Overview, Marketplace, Connect, Billing and Settings are the five destinations. Overview places the setup checklist beside the original ABI card on desktop, with workspace row above the card, then stacks on mobile. Account identifiers, balances and agent rows must be factual. Marketplace uses published provider/product inventory, search and equal category tabs without a Demo/Live selector; order content appears in the separate Purchases tab. Connect provides a dialog for one-time scoped-key creation, replacement and revocation. Never persist secrets to localStorage.

Billing has Overview and Spending limits. Calendar day/week/month windows use UTC boundaries; workspace caps are shared across agents. Total caps expire within 90 days because event retention is bounded; editing preserves the existing total-window start. Existing per-purchase/daily limits, agent budgets and approval policies remain effective. Recurring opt-out is enforced; connected-service write actions remain explicitly unavailable. USD credits remain separate from Base Sepolia USDC.

There is no More menu or standalone ledger/webhook navigation. Legacy wallet, x402, settlement, financial and audit backend code remains internally available.

## Seller workspace and authentication
Overview, Inventory, Connect, Payouts and Settings are the primary destinations. Inventory retains product/order management, returns/disputes and vendor identity. Seller overview, forms and controls use Inter and opaque neutral materials. A definitive session-check 401 ends the session; network/429/5xx and malformed responses preserve it and offer retry. Buyer/seller identity realms remain distinct, and email verification/MFA must not be bypassed. Buyer screenshots do not establish seller coverage.

## Capability boundary
Marketplace API/source includes products, vendors/inventory, quotes/orders, stock and per-item payment/delivery states, adapter boundaries, returns/disputes and feedback. Actual shipping, physical fulfillment, escrow and transactions depend on configured providers, listing state and operational verification. UI fixtures and study content do not establish real inventory, live purchases or settlement.

Wallets, x402, ledger and Base Sepolia stablecoin settlement remain. Card funding is a separate USD account with hosted Stripe payment/setup, signed webhook journal/reversals and guarded auto-top-up. It remains disabled until credentials/webhooks/config AND a defined credit-usage/cancellation/refund policy are ready. Redirect success and provider credentials alone are insufficient. No USD consumption or fiat-to-USDC conversion exists. See docs/card-funding.md.

## Verification coverage
The hybrid brief requires bounded rendered desktop/mobile evidence and independent finish review. Required surfaces include public home, buyer overview, Marketplace, Connect/key dialog, Billing/spending-limit dialog and seller overview/inventory/authentication recovery. Include narrow-screen stacking, dock clearance, focus, dialogs and honest empty/unavailable states. Review calendar/total limit controls, recurring opt-out and disabled service writes against actual contracts. Session-error behavior requires distinguishing 401 from transient failure.

This documentation pass records source behavior and required coverage; it does not assert these review steps passed. Use the actual hybrid capture/review artifacts for results. Previous minimal-reference captures and review cover only the earlier revision. Synthetic fixtures establish presentation and bounded flow behavior; API/unit checks and operational evidence establish their separate contracts. Deployment status must be reported from actual deployment evidence.
