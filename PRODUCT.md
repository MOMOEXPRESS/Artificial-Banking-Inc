# ABI

<!-- impeccable:product-schema 1 -->

## Platform
web

## Users
Buyers and sellers have equal priority. Buyers delegate discovery and purchasing to agents; sellers offer tools and API services, software and digital products, and physical goods.

## Product Purpose
ABI is an agentic marketplace for tools, software and physical goods. Shopping and seller inventory lead the experience; governed spending and inspectable approvals support both journeys.

## Capabilities and Constraints
The Next.js frontend includes public discovery, buyer and seller workspaces, approvals and explicitly simulated demo shopping. The API includes marketplace product search/details, vendor and inventory management, quotes/orders, per-item payment and fulfillment states, shipping/fulfillment adapter boundaries, returns/disputes and purchase feedback. Existing published API offers and hosted digital responses remain available. These implemented workflows do not establish configured production shipping, physical fulfillment, real inventory, or successful live purchases. Provider capability and actual listing state determine availability; keep unavailable and empty states truthful.

Preserve existing wallets, x402 middleware, ledger and stablecoin settlement. The current settlement deployment uses Base Sepolia. Do not relabel transactions as completed physical orders or infer cross-vendor escrow readiness from an interface. Connect exposes scoped credentials with read/payment permissions and finite lifetimes; replacement and revocation use existing server controls. Secrets are one-time delivery and may be used within the current tab; never persist them to localStorage.

Card-funded USD credits are a separate account from USDC and agent allowances. The card-funding backend includes hosted Stripe Checkout/setup, signed webhook processing, a durable credit journal, reversals and guarded auto-top-up. Production funding remains disabled until Stripe credentials/webhooks/configuration AND a defined credit-usage and cancellation/refund policy are established. A provider credential alone is insufficient. No USD-credit consumption or fiat-to-USDC conversion exists. Checkout redirects alone never credit funds. See docs/card-funding.md for contracts and operational limits.

## Brand Commitments
ABI retains its name, wordmark and self-hosted IBM Plex family. The user approved the o11-inspired minimalist neutral/blue direction in .impeccable/mocks/minimal-reference/{overview,catalog,billing}.png and its prompt/approval sidecars on 2026-11-07, including homepage and public-surface adaptation. Current authority is .impeccable/briefs/minimal-marketplace.md and the source-extracted DESIGN.md: near-white canvas, quiet gray rows, near-black text and restrained blue actions. Buyers use Overview, Catalog, Connect, Billing and Settings in the desktop header and floating mobile dock; sellers retain their inventory/orders/connect/payouts/settings equivalents. More preserves advanced controls for both roles. Tools & APIs, Software and Physical goods receive equal prominence. Earlier beige/green and navy-rail Assisted Shopping Studio directions are superseded. Legal entity naming remains factual.

## Evidence on Hand
Source: MOMOEXPRESS/Artificial-Banking-Inc and current implementation. Approval is recorded in the minimal-reference sidecars and surface brief. docs/research/o11-reference-study.md records public reference research; its pre-approval study status is historical and superseded by the approved sidecars/brief. Reference screenshots and generated studies establish presentation, not live provider behavior. Existing browser captures and synthetic fixtures are bounded UI evidence; final captures after reviewer fixes are pending. No Impeccable launcher, detector, comp-spec, automated region diff or build-state provenance is available; do not claim corresponding certification.

## Product Principles
- Give buyers and sellers equal design attention and the three commerce categories equal prominence.
- Make agent permissions, budgets, approvals and purchase states comprehensible and inspectable.
- Preserve existing financial controls and distinguish USD credits from testnet USDC.
- Keep demo behavior, configured capabilities and live operational evidence clearly identified.
- Do not invent vendors, partnerships, prices, adoption or production readiness.
