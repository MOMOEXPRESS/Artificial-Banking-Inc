# Marketplace redesign coverage

Status: marketplace composition 3 approved (beige dominant, forest-green accents). Product/catalog, seller, buyer and commerce implementation is pushed in PR 122. Source review complete with a fix pass; rendered validation is pending. Vercel preview build succeeded for the second implementation commit. Production/backend release is not yet verified.

## Shared system
Navigation, footer, search, category navigation, forms, tables, dialogs, notifications, loading, empty, error, keyboard focus, light/dark themes, desktop and mobile. Keep existing authentication and policy contracts intact.

## Public routes
| Route | Marketplace role |
| --- | --- |
| / | Familiar marketplace home: search, categories, merchandise, agent purchasing explanation, seller invitation |
| /directory | Searchable marketplace catalog backed by actual published offers; accurate category, seller, access and rail information |
| /about | Explain the agentic marketplace and its current stage |
| /partnerships | Seller acquisition and marketplace integrations |
| /pricing | Honest current access and capability availability; no fabricated subscription plans |
| /docs | Explain buyer, seller, and developer workflows without hiding technical contracts |
| /waitlist | Clear buyer and seller early-access paths with existing submission behavior |
| /partners/login | Seller authentication and onboarding |
| /console/signup | Buyer signup |
| /approvals | Preserve approval verification and actions; improve hierarchy and mobile controls |
| /terms, /privacy, /cookies | Readable legal pages; preserve factual legal meaning |
| error, global-error, not-found | Consistent recovery paths |

## Buyer workspace
Overview, insights, treasury, transactions, ledger, agent connections, work, approvals, policy, playground, webhooks, settings and waitlist management where currently authorized. Surface shopping-related discovery while keeping funds, ledger and approval semantics accurate. A transaction is not relabeled as a fulfilled physical order.

## Seller workspace
Overview, catalog, integrations, directory visibility, offer versions, sandbox, analytics, activity, invoices and payouts, access policies, webhooks, developer setup, settings. Show coherent selling workflows while preserving existing offer/payment API contracts.

## Capability boundary
Software/API offers exist in the present implementation. Physical product catalog fields, stock, addresses, tax, shipping, returns and fulfillment must be verified or explicitly described as future scope. Do not make a decorative physical listing actionable as a real purchasable offer. Use illustrative labels in comps, real source-backed data in working catalog views, and clear unavailable states.

## Verification
Comp approval precedes UI edits. Once implemented, run available build/type checks and inspect public, buyer and seller screens at desktop and mobile widths. Review actual authenticated states only when sessions are available. Report unavailable dependencies or runtime checks accurately.
