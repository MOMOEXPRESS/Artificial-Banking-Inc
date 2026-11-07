# ABI

<!-- impeccable:product-schema 1 -->

## Platform
web

## Users
Buyers and sellers have equal priority. Buyers delegate discovery and purchasing to agents; sellers offer tools and API services, software and digital products, and physical goods.

## Product Purpose
ABI is an agentic marketplace for tools, software and physical goods. Discovery and seller inventory lead the experience; governed spending and inspectable approvals support both journeys.

## Capabilities and Constraints
The Next.js frontend includes public discovery, buyer and seller workspaces, scoped credentials, approvals and purchase controls. The current Marketplace shows published inventory through provider/product segmentation, search and category filters, without a Demo/Live selector. Purchases remain separately accessible through the Purchases tab; order content appears there. The API includes product search/details, vendor and inventory management, quotes/orders, per-item payment and fulfillment states, shipping/fulfillment adapter boundaries, returns/disputes and purchase feedback. Existing published API offers and hosted digital responses remain available. These workflows do not establish configured production shipping, physical fulfillment, real inventory or successful live purchases. Provider capability and actual listing state determine availability; keep empty and unavailable states truthful.

Buyer destinations are Overview, Marketplace, Connect, Billing and Settings. Sellers use Overview, Inventory, Connect, Payouts and Settings. The More menu and standalone ledger/webhook navigation have been removed; existing financial, settlement and audit code remains available internally. Overview pairs the setup checklist with the original ABI vault card on desktop and stacks them on mobile. The vault card represents the workspace; it is not a card-network payment product.

Connect exposes scoped credentials with read/payment permissions and finite lifetimes. Creation uses a dialog; replacement and revocation use existing server controls. Secrets are one-time delivery and may be used within the current tab; never persist them to localStorage. Billing includes Overview and Spending limits. Spending controls support UTC calendar day/week/month caps, bounded total caps, a shared workspace cap and recurring-purchase opt-out. Total caps expire within 90 days because payment-event retention is bounded; editing an existing total window preserves its start time. Existing agent budgets, per-purchase/daily controls and approvals still apply. Connected-service write actions remain unavailable.

Seller session checks end the session only on a definitive 401. Network, rate-limit, server and malformed-response failures retain the session and offer retry. Buyer and seller identities remain separate; email verification and MFA still apply.

Preserve existing wallets, x402 middleware, ledger and stablecoin settlement. The current settlement deployment uses Base Sepolia. Do not relabel transactions as completed physical orders or infer cross-vendor escrow readiness from an interface.

Card-funded USD credits are separate from USDC and agent allowances. The backend includes hosted Stripe Checkout/setup, signed webhook processing, a durable credit journal, reversals and guarded auto-top-up. Production funding remains disabled until Stripe credentials/webhooks/configuration AND a defined credit-usage and cancellation/refund policy are established. A provider credential alone is insufficient. No USD-credit consumption or fiat-to-USDC conversion exists. Checkout redirects alone never credit funds. See docs/card-funding.md for contracts and operational limits.

## Brand Commitments
ABI retains its name, actual wordmark and original charcoal/silver VaultBankCard. The current authority is .impeccable/briefs/abi-o11-hybrid.md and the approved .impeccable/mocks/abi-o11-hybrid/overview-study.png, with implemented values recorded in DESIGN.md. The user selected the original ABI console/card combined with o11 typography, placement and materials: self-hosted official Inter variable under SIL OFL, #fafafa canvas, #262626 ink, #525252 secondary text, opaque #f4f4f4 working surfaces, #e5e5e5 fields and restrained blue actions. Glass is reserved for navigation, menus and the ABI card. IBM Plex Mono remains for code and credentials. Tools & APIs, Software and Physical goods receive equal prominence. The previous minimal-reference composition, IBM Plex body typography, beige/green and navy-rail directions are superseded. Public-home structure is retained with shared typography and chrome adaptation. Legal entity naming remains factual.

## Evidence on Hand
Source: MOMOEXPRESS/Artificial-Banking-Inc and current implementation. The hybrid brief records current user steering; its generated study establishes presentation only and includes illustrative content that must not become account data. Older minimal-reference reviews do not certify this revision. Desktop/mobile captures and independent finish review for the hybrid revision must be assessed through their actual review artifacts; this document makes no completion claim. Browser fixtures establish bounded UI behavior, not live funding, purchases, inventory or fulfillment.

## Product Principles
- Give buyers and sellers equal design attention and the three commerce categories equal prominence.
- Make agent permissions, budgets, approvals and purchase states comprehensible and inspectable.
- Preserve existing financial controls and distinguish USD credits from testnet USDC.
- Keep simulated evidence, configured capabilities and live operational evidence clearly identified.
- Do not invent vendors, partnerships, prices, adoption or production readiness.
