# Marketplace redesign coverage

Current authority: user-approved minimal-reference overview/catalog/billing studies and .impeccable/briefs/minimal-marketplace.md (2026-11-07), with source-extracted DESIGN.md and .impeccable/design.json. Homepage/public adaptation is approved; push/deploy is authorized. Earlier beige/green composition and navy-rail Assisted Shopping Studio are superseded. Authorization is not deployment evidence; this document does not certify a release.

## Shared system
Neutral near-white canvas, quiet gray rows, dark text, restrained blue actions and retained self-hosted IBM Plex/ABI branding. Desktop header has five destinations; mobile has a floating five-destination dock at 760px. Preserve focus, native semantics, reduced motion, loading/empty/error/unavailable states, authentication and policy contracts. Existing dark-theme console selection receives the same light neutral overrides; no separate current dark palette is asserted.

## Public routes
| Route | Coverage / truth |
| --- | --- |
| / | Minimalist homepage implemented: marketplace proposition, equal Tools & APIs / Software / Physical goods entries, real catalog component, agent controls and seller invitation |
| /directory, /products/[id] | Source-backed catalog/details; search and kind/category filters, real listing availability and capability boundaries |
| /about, /partnerships, /pricing | Shared neutral public chrome; factual marketplace, seller and availability messaging |
| /docs | Buyer/seller/developer workflows; retain accurate technical contracts |
| /waitlist, /partners/login, /console/signup | Preserve existing submission, seller authentication and buyer signup behavior |
| /approvals | Preserve verification and approval semantics |
| /terms, /privacy, /cookies | Readable legal content and factual entity naming |
| error, global-error, not-found | Existing recovery paths; not independently recertified in this documentation pass |

Shared CSS reaches public .landing surfaces; the homepage has the new composition. Do not infer a separately redesigned or browser-verified composition for every route from shared styling alone.

## Buyer workspace
Overview, Catalog, Connect, Billing, Settings are the primary destinations. Overview exposes factual setup, workspace USDC and allowances. Catalog preserves equal categories, actual filters/results, shortlist and explicit Demo/Live separation. Connect manages scoped credentials, finite lifetimes, one-time secrets, replacement and revocation. Billing separates USD credit liability from Base Sepolia USDC. Settings retains supported controls.

More retains Assistant, Agents & allowances, USDC treasury, Payments & approvals, Activity, Agent work, Policies, Ledger, API playground and Webhooks. Existing advanced features are preserved, not certified by a minimalist screenshot. Credential secrets are not persisted to localStorage.

## Seller workspace
Inventory, Orders, Connect, Payouts and Settings are the primary destinations. Orders opens the inventory orders panel. More retains Overview, Directory, Versions, Sandbox, Analytics, Activity, Access policies, Webhooks and Developers. Inventory includes product and order management plus returns/disputes and vendor identity. Existing offer/payment API contracts remain; seller coverage is not implied by buyer-only captures.

## Capability boundary
Marketplace API/source includes products, vendor/inventory management, quotes/orders, stock and per-item payment/delivery states, provider adapters, returns/disputes and feedback. Backend workflows exist. Actual live physical fulfillment, shipping, escrow and transactions still depend on configured providers, listing state and operational verification. Do not label the implemented backend as wholly future scope or imply all physical fulfillment is live. Demo facts and progress remain simulated; UI evidence is not inventory or settlement evidence.

Existing wallets, x402, ledger and stablecoin settlement are preserved; the current settlement deployment is Base Sepolia. Card funding is a separate USD account with hosted Stripe payment/setup, signed webhook journal/reversals and guarded auto-top-up. It stays disabled until Stripe credentials/webhooks/config AND a defined credit-usage/cancellation/refund policy are ready. No USD-credit consumption or fiat-to-USDC conversion exists. Provider credentials and redirect success alone are insufficient. See docs/card-funding.md.

## Verification
Approved mock sidecars and the brief establish visual direction. Existing desktop/mobile captures cover home, overview, catalog, connect and billing at 1440 and 390px; console captures show the independently scrolling pane’s first viewport. Browser fixtures are synthetic and establish presentation/key-flow evidence only. Financial checks belong to separate API/unit tests; do not claim live card collection or live provider purchases from fixtures.

.impeccable/review/minimal-reference/finish-review.md identified category-label contrast, Overview first-viewport density and documentation drift. Source fixes for contrast/density are applied; this pass refreshes PRODUCT.md, DESIGN.md, .impeccable/design.json and this plan. Final screenshots confirming the source fixes are pending at this documentation handoff. No launcher/detector, comp-spec, automated region diff or build-state provenance is available; no corresponding certification is asserted. Run available checks and use the final browser report for the eventual verification outcome rather than promoting approval into a passed check.
