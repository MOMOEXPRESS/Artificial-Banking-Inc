# ABI: current product → agentic marketplace audit

Date: 6 November 2026. Source snapshot: `MOMOEXPRESS/Artificial-Banking-Inc`, commit `27035954bb52ac6f5f1d0dbd91b86740bd9e537a`.

## Verdict and scope

ABI is a governed agent-spending product with an API-offer marketplace foundation and an additive products spike. It is not yet an end-to-end marketplace for software and physical goods. The main gap is the commerce lifecycle above payments: product publication → discovery → quote → inventory reservation → order → vendor payment → fulfillment → receipt/return/dispute.

This audit maps every item in the user's checklist to inspected source and a concrete acceptance criterion. It covers public navigation and pages, buyer and seller workspaces, the listing/storage contracts, discovery, assistant tools, fulfillment and escrow integration. It is a source audit, not a live transaction, security certification or browser accessibility certification. Relevant tests were inspected, not executed. No implementation, merge or deployment is claimed.

Wallet infrastructure, x402 middleware and stablecoin settlement are protected scope. No production source was edited for this audit. Product, design and audit documents and illustrative mockups are the only new/changed artifacts.

Visual commitment: ABI name; warm beige as dominant canvas; forest-green controls and selected states; Shopify storefront clarity, Amazon search/category utility and Etsy discovery; eBay excluded. Buyer and seller experiences have equal priority. Three revised composition studies are pending selection; none is implemented.

## Checklist reconciliation

| Requirement | Current evidence | Status and remaining work |
| --- | --- | --- |
| First-class products and requested fields | `apps/api/src/store.ts:2075` products table includes name, description, category, price_micro, currency, stock_level, vendor_id, images_json and attributes_json; `packages/db/prisma/schema.prisma:670` mirrors Products | Foundation present. Structured attributes are an arbitrary JSON record, not a validated category-specific contract. Need product kind, publication lifecycle, variant/SKU structure and vendor ownership rules. |
| New products table | Same table and indexes | Already implemented in inspected snapshot. Do not create a competing table. |
| Listings API | `apps/api/src/listings-routes.ts:61`; registered at `apps/api/src/index.ts:675` | Partial: guardian-authenticated POST and tenant-scoped GET by ID. No complete seller inventory CRUD, collection listing, publication or buyer product endpoint. |
| Vendor identity | `routes/partner-auth-routes.ts`; `seller-ownership.ts:1`; `kyc-kya.ts:1` | Email authentication, endpoint origin proof and internal self-attestation exist. They do not establish independent vendor identity verification. Need a defined verification process, evidence, review states and publication gate. |
| Stablecoin payout connection | `routes/seller-routes.ts:39`, profile payout checks and payout-change password/MFA protection | Existing infrastructure to reuse. Configured EVM payout address is not by itself proof of legal vendor identity or payout-wallet control. Deployment readiness requires runtime verification. |
| Seller inventory management | `apps/web/src/lib/seller-catalog.tsx:385`; seller offer CRUD in `routes/seller-routes.ts:628` | Existing dashboard manages paid endpoints and hosted content. Not connected to products, stock, variants, images, shipping or physical inventory. |
| Machine-readable listing format | Zod product input and offer DTO; `connections-panel.tsx:15` | Partial internal shapes. Need versioned public schema, stable IDs, fulfillment type, supported region, typed delivery promises, currency scale, stock semantics and schema-version compatibility. |
| Natural-language/structured discovery | `routes/seller-routes.ts:1026` | Keyword substring plus exact category/network filters over offers exists. No semantic interpretation or product search contract. |
| Ranked results with price, rating, delivery and stock | Same route; `store.ts:8481` orders directory rows by updated time | Price is present for offers. No relevance ranking, product availability, delivery calculation or review-backed rating output. No result pagination in inspected handler. |
| Semantic vague-query search | No such tool/endpoint in inspected search and assistant interfaces | New work: retrieve candidate products semantically, then enforce structured availability/region/budget filters and explain ranking. Never let semantic similarity override eligibility. |
| Carts | No cart/order model or route in inspected storage and API registration | New cart and cart-item entities, versions, quote expiry and owner/session scoping. |
| Multi-vendor payment session | `connections-panel.tsx:218` buys one offer; settlement records identify an offer | Existing individual payments are not an orchestration layer. Need per-vendor child orders, payment attempts, idempotency and explicit partial success. |
| Durable orders and line status | Payment events, settlements and journals exist | New orders/order-items and immutable snapshots, with separate payment and fulfillment statuses. A successful payment is not delivered merchandise. |
| Instant digital API delivery | `seller-x402.ts:324` settles then returns hosted content at line 362 | Partial: immediate content response exists. Need durable purchased entitlement, authenticated retry/retrieval, delivery audit and refund/revocation rules for downloads/licenses. |
| Shipping, tracking and returns | No physical fulfillment entities in inspected schema/routes | New address handling, shipping quotes, provider adapters, shipment/item allocation, signed tracking events and return workflow. Requires shipping-provider configuration. |
| Human reviews/ratings | No purchase-linked review model in inspected schema/routes | New verified-purchase eligibility, rating aggregation, moderation and seller response. Never manufacture ratings in listings. |
| Agent quality signals | Usage/settlement events exist | New structured signal ingestion with agent identity, order/item link, provenance, quality dimensions and abuse controls; keep separate from human ratings. |
| Dispute resolution | `index.ts:2561` guardian escrow resolution | A financial resolution action exists, not a cross-party marketplace case workflow. Need evidence, participants, deadlines, appeals/policy and resolution audit. |
| Escrow until buyer confirms | `index.ts:2928` locks to another agent in the same org | Existing primitive is not cross-vendor marketplace escrow. Requires compatibility design; do not promise support or change settlement under this task. |
| Assistant shops through x402 | `abi-agent/llm-loop.ts:257`, `abi-agent/tools.ts:13` | Assistant explicitly cannot pay/approve; tool registry is operational/read-only for money. Add authenticated commerce tools and a confirmed purchase-intent workflow above existing payment APIs, never remove policy enforcement. |
| Leave money layer untouched | User's explicit constraint | Preserve wallet, x402 and stablecoin settlement implementations and contracts. Escrow behavior is a compatibility blocker if current primitives cannot satisfy cross-party requirements. |

## Prioritized findings

Severity here describes readiness for the requested marketplace, not an allegation that every missing feature is a defect in the present spending product. Four P0 launch blockers, seven P1 major gaps and three P2 implementation issues are identified.

### P0 — marketplace launch blockers

1. **Disconnected product and offer models.** Locations: `store.ts:2075`, `listings-routes.ts:61`, `seller-catalog.tsx:385`, `directory/page.tsx:15`. A product can be recorded but not managed and purchased through the existing seller/directory flow. Establish a Product → versioned Listing/Offer relationship; seller-scoped authorization must derive or validate vendor ownership. Acceptance: seller creates, edits, publishes and unpublishes a product; an eligible buyer can find the same published record; cross-vendor writes fail. Suggested UI command: `$impeccable shape` after the backend contract is defined.

2. **No durable checkout/order/inventory lifecycle.** Locations: product stock is a passive integer in `store.ts:2083`; current purchase state is an offer-local client state in `connections-panel.tsx:34`. A cart/session must survive refresh, concurrent buyers and payment uncertainty. Add carts, immutable quotes, reservations with expiry, parent/child orders, item transitions and reconciliation. Acceptance: two buyers cannot both buy the last unit; retry cannot double-debit; one vendor's failure does not erase another vendor's success; unknown settlement blocks blind retry. Suggested UI command: `$impeccable harden`; backend work required.

3. **Assistant cannot perform the requested shopping job.** Locations: `abi-agent/llm-loop.ts:257`, `tools.ts:13`. Copy changes cannot turn a read-only guardian assistant into a shopping agent. Introduce search, compare, prepare-quote, review and execute-intent tools scoped to the authenticated owner/session and existing policy system. Acceptance: a vague request produces real eligible candidates; budget/preferences are verified server-side; an approved intent executes once through the existing API; catalog prompt injection cannot change permissions. Suggested UI command: `$impeccable shape`; backend and tool work required.

4. **Current escrow does not establish cross-vendor buyer-confirmed settlement.** Location: `index.ts:2952` looks up the payee through `scopedStore(auth.orgId)` and rejects an outside-org payee. Existing direct seller x402 payments settle to the seller rather than an order-confirmation escrow. Do not repurpose same-org escrow or silently redirect settlement. Acceptance: document whether the unchanged rails can support the required flow; if not, mark it blocked pending an explicitly scoped escrow extension or external integration. Define who confirms delivery, expiry, partial release, dispute and refund behavior first. Suggested UI command: `$impeccable clarify` for honest availability labels.

### P1 — major product gaps

5. **Vendor verification is not the requested identity verification.** Locations: `seller-ownership.ts:1`, `kyc-kya.ts:1`, `routes/seller-routes.ts:178`. Domain control, email checks and self-attestation answer different questions. Separate those statuses in onboarding; bind product publisher and payout owner to the vendor record. Acceptance: publication and payout readiness show the actual proof collected and cannot be inferred from endpoint verification. Suggested UI command: `$impeccable onboard`.

6. **Listing contract lacks fulfillment and pricing semantics.** Location: `listings-routes.ts:21`. Arbitrary attributes and a free-form currency code cannot define stock units, size variants, region coverage, delivery promises or decimal scale. Define a versioned product/listing schema; keep settlement currency eligibility explicit. Product images accept external URLs, but `apps/web/next.config.mjs` currently permits same-origin/data/blob images only: use a safe controlled asset upload/serving path rather than weakening CSP. Acceptance: malformed and cross-vendor input fails; valid product images render; display and settlement amounts round-trip exactly. Suggested UI command: `$impeccable harden`.

7. **Discovery is substring filtering over offers.** Locations: `seller-routes.ts:1026`, `store.ts:8481`, `directory/page.tsx:20`. It cannot reliably answer gift intent, rank by relevance, or expose truthful ratings, delivery and stock. Add paginated product retrieval, structured facets and semantic ranking; structured constraints remain authoritative. Acceptance: representative vague queries return eligible products with ranking explanations, explicit unavailable data and deterministic filters. Suggested UI command: `$impeccable shape`.

8. **Digital response is not a complete digital entitlement.** Location: `seller-x402.ts:362`. Network failure after payment must not make the purchased content irretrievable. Add order-linked entitlements, authenticated retrieval and delivery evidence above the unchanged settlement path. Acceptance: the buyer can recover an already paid deliverable after refresh without a second charge; another buyer cannot retrieve it. Suggested UI command: `$impeccable harden`.

9. **Physical fulfillment and returns are absent from the inspected commerce contracts.** Locations: products schema and listing DTO have no shipment/return relationships. Add addresses, quote/tax components, shipment objects, tracking updates and return authorizations before exposing real physical checkout. Acceptance: mixed digital/physical orders track each item independently; failed label creation does not falsely mark an order shipped; duplicate/out-of-order carrier events are safe. Suggested UI command: `$impeccable shape`.

10. **Marketplace reputation and disputes need their own records.** Locations: seller usage analytics, generic escrow resolution and existing schemas. A paid call count is not a review; a guardian release/refund is not a vendor-owner dispute process. Build verified-purchase reviews, separately attributed agent signals and cases with evidence/deadlines. Acceptance: duplicate/fabricated reviews are rejected, human and agent scores remain distinguishable and each resolution references the correct item/payment. Suggested UI command: `$impeccable harden`.

11. **Public story and workspace hierarchy still teach a spending product.** Locations: `layout.tsx:44`, homepage hero, `about/page.tsx:23`, `marketing-shell.tsx:97`, buyer `console/page.tsx:104`, seller `seller-console.tsx:85`. Visitors reach console/developer concepts rather than shopping; sellers are taught to create paid URLs. Rework the complete journey after composition approval, while retaining truthful current-availability labels. Acceptance: a newcomer can find products, ask an agent and become a seller from primary navigation; technical money concepts remain accessible under budgets, payments and developer setup. Suggested UI commands: `$impeccable clarify`, then `$impeccable layout`.

### P2 — implementation quality issues

12. **Public wayfinding lacks consistent page semantics.** Locations: `marketing-shell.tsx:23`, `SectionHead` at line 252, directory/docs/pricing page bodies. Shared chrome does not supply a main landmark, and several page titles use an h2-producing helper with no page h1. Add one main landmark and a descriptive h1 per public page; expose active navigation consistently with aria-current. This is a source-level wayfinding issue; it is not a blanket claim of WCAG nonconformance. Acceptance: landmark/headings inspection and keyboard navigation on the rendered routes. Suggested command: `$impeccable harden`.

13. **Brand tokens do not implement the confirmed beige/green direction.** Locations: `globals.css:5` and light/dark token blocks; `marketing-shell.tsx` hard-coded logo tones. Current gray/blue tokens and fixed logo tones need a coherent semantic beige/green mapping across public, buyer, seller and legal pages. Preserve existing dark-mode capability and validate both modes. Acceptance: shared states have measured text/focus contrast; no category-specific color overrides silently restore the old theme. Suggested command: `$impeccable colorize`.

14. **Responsive and motion quality needs rendered verification.** Locations: `components/ui/button.tsx:26` uses 32–40px standard button heights; `design-system.css:284` globally shortens animations/transitions to 0.01ms. Compact controls merit touch-usability review; height alone is not an automatic WCAG 2.2 AA failure. Replace blanket motion suppression with component-specific alternatives where state feedback matters. Acceptance: desktop/mobile keyboard and touch checks, zoom, long product names, translated text and reduced-motion states. Suggested commands: `$impeccable adapt`, `$impeccable animate`.

## Top-to-bottom route integration plan

| Surface | Required marketplace change | Preserve |
| --- | --- | --- |
| Homepage and shared header/footer | Beige/green search, categories, assistant entry, real catalog highlights and equally clear seller path; explain available vs planned capabilities | ABI identity and truthful environment/availability statements |
| Directory/catalog | Server-driven products, facets, ranking, stock and delivery metadata, product detail links and accessible loading/error/no-results states | Published-offer visibility and access-policy checks |
| About | Agentic marketplace purpose and buyer/seller use cases | Accurate legal entity and maturity claims |
| Partnerships | Vendor onboarding, catalog/agent integration, seller requirements | Actual authentication and endpoint ownership setup |
| Pricing | Explain current access; show fees/plans only once commercially defined | Existing 'not for sale/roadmap' honesty |
| Docs | Buyer shopping flow, seller listing contract, agent tool contract and fulfillment lifecycle | Existing wallet/x402 integration docs and exact security contracts |
| Waitlist and signups | Clear buyer/seller intent and separate next steps | Existing email, consent, verification and authentication behavior |
| Buyer console home | Assistant/search front door, required purchase reviews, active orders and delivery attention | Policy decisions and real account balances |
| Buyer discovery and agent connections | Catalog/shortlists and appropriate machine-readable integration details | Agent credentials and scopes |
| Buyer budgets/payments/ledger | Shopping budget context, order-linked records and payment/fulfillment distinction | Financial meanings, reconciliation, approvals and journal truth |
| Buyer approvals | Quote snapshot, vendor/item/total, budget impact and explicit action | Deterministic re-check, expiry, quorum, idempotency and authorization |
| Buyer orders/returns/disputes | New durable lifecycle views after backend support | No fictitious shipping or delivery states |
| Seller overview/catalog | Product inventory and publication readiness; products/variants/media editor | Existing offers and historical settlement records |
| Seller integrations/directory/versions/sandbox | Listing schema, agent discoverability, versioned offers and test readiness | Working x402 verification, origin proof and access controls |
| Seller analytics/activity/billing | Order/item context alongside actual sales and payouts | Existing settlement/invoice accuracy |
| Seller policies/webhooks/developers/settings | Buyer permissions, commerce events, credentials, vendor identity and payout readiness | Existing security/MFA/session controls |
| Terms/privacy/cookies | Review physical commerce, digital licenses, agent delegation, addresses and dispute responsibilities when those policies are decided | Legal meaning; no invented policy commitments |
| Error/empty/loading states | Next action appropriate to shopping or selling; preserve entered search/cart intent | No fabricated records when backend requests fail |

## Integration architecture and delivery sequence

1. **Contracts and identity:** use the existing products table; establish vendor binding, publication, typed attributes, media and fulfillment type. Define the product/listing/offer relationship and machine-readable schema. Do not duplicate products or migrate away working offers blindly.
2. **Seller → discovery slice:** seller inventory CRUD and publication, buyer product list/detail, exact filters, real stock and pagination. Add semantic ranking only over eligible published candidates. This establishes a useful marketplace before checkout promises.
3. **Quote → order slice:** immutable quote totals and currency units; atomic inventory reservation; parent order and per-vendor child orders; line-level payment/delivery state. Orchestrate existing payment APIs with persistent idempotency and recovery; never treat multi-vendor payments as an atomic blockchain transaction.
4. **Assistant shopping slice:** retrieval and comparison, preferences/budget lookup, prepared purchase review, scoped execution via existing governed x402 APIs. Model output proposes; server policy decides. Persist intent/order links and make unresolved payments explicit.
5. **Fulfillment slice:** durable digital entitlements first; physical address/quote/shipment/tracking/returns next. Keep buyer order status independent from vendor payment status.
6. **Trust slice:** verified reviews, agent signals, vendor-owner cases. Resolve escrow compatibility before advertising delayed buyer-confirmed release. Keep the money layer unchanged unless a separate extension is explicitly authorized.
7. **UI completion:** approved beige/green composition across every mapped route; responsive and accessibility pass; `$impeccable polish` last.

## Health score and verification limits

An honest 0–20 rendered health score is not available from this source-only pass. Accessibility, performance, responsive behavior and dark-mode contrast require rendered evidence; assigning them numeric scores would imply checks not performed. Source implementation integrity **fails against the target marketplace workflow**, while the existing spending/offer product has useful coherent foundations. This is a target-fit verdict, not a claim that current payment controls are defective.

Confirmed positives: tenant-scoped product reads; integer price storage/input; product round-trip/validation/isolation test coverage in `listings.api.test.ts`; existing seller CRUD/publication and domain-control proof; payout-change password/MFA protection; hosted digital response path; deterministic budget/approval architecture; scoped agent APIs; explicit reduced-motion handling in LandingMotion; many form controls have proper wrapping labels. Preserve these.

No new automated tests or live transactions were run. The workspace is a selectively retrieved source snapshot, not a complete installed checkout. The Git clone failed because the configured proxy was unreachable. The Impeccable launcher/detector is absent, so its context, phase and detector commands could not run; no detector pass is claimed. Mockups are generated concept studies, not browser screenshots or evidence of implementation.

Release evidence required after implementation: full build/typecheck; existing payment-policy/idempotency/tenant tests; product ownership/publication tests; last-unit inventory race; duplicate checkout; quote expiry; per-vendor partial success; unknown settlement recovery; entitlement retrieval isolation; tracking webhook replay; review eligibility; dispute authorization; assistant tool authorization and catalog prompt injection. Run browser checks on public, buyer and seller flows at desktop/mobile widths with actual authenticated test sessions, both themes and reduced motion.

This audit makes no changes to the wallet, x402 middleware or settlement code. Those layers remain protected by the user's explicit instruction.
