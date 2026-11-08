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

Buyer destinations are Overview, Marketplace, Connect, Billing and Settings. Sellers use Overview, Inventory, Connect, Payouts and Settings. The More menu and standalone ledger/webhook navigation have been removed; existing financial, settlement and audit code remains available internally. Overview pairs the setup checklist with the approved clear liquid-glass ABI wallet card on desktop and stacks them on mobile. The full card opens Wallet, which replaces the old Treasury/Vault/Budgets/Move presentation while retaining the internal treasury route and APIs. Wallet places the card left and actual balance rows/actions right on desktop, with allocations and actual activity below; mobile stacks. The card represents the workspace, without card numbers or payment-network branding. The buyer header omits Sell on ABI; the account menu retains seller entry.

Connect exposes scoped credentials with read/payment permissions and finite lifetimes. Creation uses a dialog; replacement and revocation use existing server controls. Secrets are one-time delivery and may be used within the current tab; never persist them to localStorage. New keys default to read scopes; payment permission is explicit and uses the agent’s existing allowance, spending controls and approval rules. Creation omits x402BudgetUsdc rather than creating a separate key cap; existing capped keys remain visibly capped and enforced. Purchase limits are managed in Billing → Spending limits. Billing includes Overview and Spending limits. Spending controls support UTC calendar day/week/month caps, bounded total caps, a shared workspace cap and recurring-purchase opt-out. Total caps expire within 90 days because payment-event retention is bounded; editing an existing total window preserves its start time. Existing agent budgets, per-purchase/daily controls and approvals still apply. Connected-service write actions remain unavailable.

Seller session checks end the session only on a definitive 401. Network, rate-limit, server and malformed-response failures retain the session and offer retry. Buyer and seller identities remain separate; email verification and MFA still apply.

Preserve existing wallets, x402 middleware, ledger and stablecoin settlement. The current settlement deployment uses Base Sepolia. Do not relabel transactions as completed physical orders or infer cross-vendor escrow readiness from an interface.

Card-funded USD credits are separate from USDC and agent allowances. The backend includes hosted Stripe Checkout/setup, signed webhook processing, a durable credit journal, reversals and guarded auto-top-up. Production funding remains disabled until Stripe credentials/webhooks/configuration AND a defined credit-usage and cancellation/refund policy are established. A provider credential alone is insufficient. No USD-credit consumption or fiat-to-USDC conversion exists. Checkout redirects alone never credit funds. See docs/card-funding.md for contracts and operational limits.

Wallet offers verified Receive, group allowance allocation, internal Move, pending movements and recent activity from actual APIs. Move requires review before POST and preserves a selected department or shared destination. Invalid or failed receiving-profile refreshes clear the prior profile so a stale address cannot remain offered as verified. Unavailable balances and addresses remain explicit; summary totals count actual organization, department and shared wallets once, excluding agent aliases. Settings → Security and recovery owns custody recovery with per-operation confirmation. Existing Cash/analytics, custody, x402 middleware, ledger, settlement and approval contracts remain.

## Brand Commitments

ABI retains its name and actual wordmark; the approved clear liquid-glass LiquidWalletCard replaces the charcoal/silver card in Overview and Wallet. The current wallet authority is .impeccable/briefs/abi-liquid-wallet.md and the explicitly approved .impeccable/mocks/abi-wallet-refinement/wallet-liquid-glass.png with its approval JSON. wallet-mobile.png supplies stacking only; its earlier smoked card is superseded. The o11 hybrid brief/study remain the shared console authority, with implemented values recorded in DESIGN.md. The user retained the ABI console and selected clear liquid glass for the wallet card, with o11 typography, placement and materials: self-hosted official Inter variable under SIL OFL, #fafafa canvas, #262626 ink, #525252 secondary text, opaque #f4f4f4 working surfaces, #e5e5e5 fields and restrained blue actions. Glass is reserved for navigation, menus and the ABI card. The card uses an authored alpha WebP optical rim, semantic text and the actual ABI mark; a restrained mouse highlight and small hover lift respect reduced motion. Gray working content stays opaque. IBM Plex Mono remains for code and credentials. Tools & APIs, Software and Physical goods receive equal prominence. The previous minimal-reference composition, IBM Plex body typography, beige/green and navy-rail directions are superseded. Public-home structure is retained with shared typography and chrome adaptation. Legal entity naming remains factual.

## Evidence on Hand

Source: MOMOEXPRESS/Artificial-Banking-Inc and current implementation. The liquid-wallet brief and approved mock record current user steering; generated figures establish presentation only and must not become account data. Source now clears malformed receiving profiles and preserves allocation destinations following review. The fresh finish verdict is ship after both review findings were resolved. A refreshed bounded browser batch contains 14 screenshots and report.json; synthetic checks cover malformed successful responses and 503 failures clearing the receiving profile, and second-department/shared allocation destinations. The final build passes; lint has zero errors and eight baseline warnings. No production release or live financial operation is established by this evidence. Older reviews do not certify this revision. Launcher, detector, phase and spec automation are unavailable; no automated certification is claimed. Browser fixtures establish bounded UI behavior, not live funding, purchases, inventory or fulfillment.

## Product Principles

- Give buyers and sellers equal design attention and the three commerce categories equal prominence.
- Make agent permissions, budgets, approvals and purchase states comprehensible and inspectable.
- Preserve existing financial controls and distinguish USD credits from testnet USDC.
- Keep simulated evidence, configured capabilities and live operational evidence clearly identified.
- Do not invent vendors, partnerships, prices, adoption or production readiness.

Liquid-wallet evidence: .impeccable/review/liquid-wallet/report.json and 14 captures (overview, wallet, receive, allocate, move-review, payment-key and recovery-review at 1440px/390px). Artifacts are local and ignored, not committed. Browser script/log: /tmp/abi-wallet-browser.cjs and /tmp/abi-wallet-browser-final.log. Final build: /tmp/abi-wallet-review-build.log. Test logs: /tmp/abi-wallet-payment-tests2.log (20 cases), /tmp/abi-wallet-web-tests.log (156 cases), /tmp/abi-wallet-receive-tests.log (2 new cases). These source/test records do not establish a production release.

Settings now keeps profile, seller configuration, Team & quorum, Security and Compliance, with a shortcut to the actual Connect page. Retired operator-facing sections and the treasury threshold control are absent from the UI; backend enforcement is preserved. Marketplace Resources reads purchased nonphysical items from actual orders and retrieves available content through the existing authenticated delivery API. Escrow-held or unfinished items show access pending. Agent marks use a triangular Claude/Codex/Cursor cluster in the Connect navigation slot and connection actions.
