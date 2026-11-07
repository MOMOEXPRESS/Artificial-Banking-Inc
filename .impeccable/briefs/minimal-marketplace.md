# ABI minimalist marketplace

Approved 2026-11-07: the user chose the three overview/catalog/billing studies in `.impeccable/mocks/minimal-reference`, requested the homepage and other public surfaces follow the same direction, and explicitly authorized pushing and deploying.

## Direction contract

Console mode: Operate. Public homepage: Persuade. Other public documents: Read.

White #fafafa canvas, quiet gray #f1f1f1 rows, near-black #252525 text, restrained #246bc4 primary actions. Retain the self-hosted IBM Plex family and ABI wordmark. Replace the old dark rail and dense blue studio navigation with five clear destinations: Overview, Catalog, Connect, Billing, Settings. Keep existing advanced controls under More. A floating five-destination mobile dock follows the reference.

First viewport: Overview presents the setup checklist, workspace balance and agent allowances. Catalog leads with search and equally visible Tools & APIs, Software and Physical goods. Connect explains scoped credentials, creation, replacement and revocation. Billing separates card-funded USD credits from USDC settlement funds and shows unavailable provider states honestly. The public homepage immediately names the marketplace, its three equal categories and the next action.

Interaction: an agent gets explicit read/pay permissions and a finite session lifetime. A payment-enabled scoped key can be used for shopping within the current tab; secrets are never persisted to browser localStorage. Replacing preserves the key identity, allowance and expiry; revocation invalidates its secret. Catalogue filters act on live listings. Demo shopping remains explicitly simulated and available separately. Payment redirects alone never credit an account.

Motion: retain the existing short console entrance; respect reduced motion and settle entrances before screenshots. Quiet hover and focus feedback, no decorative hero animation.

## Evidence and limits

The three generated studies are approved proposals, not evidence of actual funds, vendors, payment processors or live transactions. Their prompts and approval evidence are recorded beside each PNG. Public o11 documentation was inspected as reference material; no reference account was modified. Source-backed research is in `docs/research/o11-reference-study.md`.

The Impeccable launcher was unavailable in this environment. No comp-spec, automated region diff, detector result or build-state provenance is asserted. Manual comparison and browser screenshots are the available fidelity evidence. Comp deviations required by product truth: live USDC values replace illustrative balances; unavailable card funding is clearly disabled; API keys live on Connect rather than permanently exposed in Billing.

Desktop/mobile captures cover home, overview, catalog, connect and billing at 1440 and 390 pixels. Console captures show its first viewport; the app's content pane scrolls independently. Synthetic API fixtures are labeled in the accompanying browser report and never written to production. Financial behavior is covered by separate API/unit tests, not implied by these fixtures.
