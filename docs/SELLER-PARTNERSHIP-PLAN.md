# Seller partnership plan

**Status:** Seller console + catalog in progress  
**Locked / clarified decisions:**

1. **Force separate seller org** for partners (`Acme Buyer` ≠ `Acme Seller`).
2. **Directory listed by default (opt-out)** — published offers appear in the buyer directory (`GET /v1/directory/offers`) unless the seller sets `directoryListed: false` on the offer. Agents can always reach offers on the **seller’s own site** too.
3. **BYO + snippet** over hosted paywall (hosted deferred if BYO churn is high).
4. **Buyer console stays buyer-only.** Seller gets a **dedicated seller console** (same design system), entered from marketing **Partnerships** → partner login.
5. **Separate partner accounts.** Partner logins are not linked to buyer accounts (same email may exist in both). Sign-up creates the seller org from the partner's company details. No buyer/seller switcher anywhere.

## Product thesis

- **Buyer console** (`/console`): agent treasuries, policy, approvals, spend.
- **Seller console** (`/seller`): catalog, x402 integrate, inbound activity.

```text
Seller site or buyer directory → agent hits paid resource → x402 / ABI challenge
→ agent’s buyer org policies + pay_api → USDC to seller wallet → resource unlocks
→ seller sees settlement on Activity
```

Money settles USDC to the **seller wallet** via the x402 facilitator. ABI does not custody seller funds.

## Org model

| Rule            | Detail                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------ |
| `orgs.kind`     | `buyer` (default) or `seller` — security boundary                                                            |
| Partner account | `partner_accounts` (own email/password) owns exactly one seller org; never in `users`/`memberships`          |
| Partner session | `partner_sessions` + `abi_partner_session` / `abi_partner_csrf` cookies — independent of buyer `abi_session` |
| Buyer org       | Refuses `workspace=seller\|both` — selling needs a partner account                                           |
| Entry           | `/partnerships` → `/partners/login` (sign in / become a partner) → `/seller`                                 |

Partner auth API: `POST /v1/partner/auth/signup` (creates account + seller org + profile), `POST /v1/partner/auth/login`, `POST /v1/partner/auth/logout`, `GET /v1/partner/auth/me`. All `/v1/seller/*` routes authenticate with the partner session only; buyer sessions and guardian keys get 401.

Email verification: sign-up sends a link to `/partners/login?verify=…` (`POST /v1/partner/auth/email/verify`, resend via `POST /v1/partner/auth/email/resend`); login is refused until verified. `ABI_ALLOW_UNVERIFIED_SIGNUP=1` (testnet only) skips it and signs the partner in immediately.

Deploy: the console and API must ship from the same commit. A console calling `/v1/partner/*` against an older API Worker gets `API_ROUTE_MISSING` (Express 404).

## Seller navigation

| Nav              | Purpose                                               |
| ---------------- | ----------------------------------------------------- |
| **Overview**     | Profile readiness, offer counts, next actions         |
| **Catalog**      | Offers (SKU / endpoint / price) — unit agents pay for |
| **Integrations** | BYO verify + snippet for each offer                   |
| **Activity**     | Inbound settlements / payments                        |
| **Developers**   | Snippets, challenge shape, webhook notes              |
| **Settings**     | Seller profile + payout wallet                        |

## Schema

```sql
ALTER TABLE orgs ADD COLUMN kind TEXT NOT NULL DEFAULT 'buyer';

CREATE TABLE partner_accounts (...);       -- separate partner identity, 1:1 seller org
CREATE TABLE partner_sessions (...);
CREATE TABLE seller_profiles (...);
CREATE TABLE offers (...);                 -- catalog
CREATE TABLE offer_integrations (...);     -- verify / snippet state
CREATE TABLE partnerships (...);           -- optional buyer↔seller links (later)
CREATE TABLE seller_settlements (...);     -- activity (later fill from pay path)
```

## Phases

| Phase | Scope                                                                                     |
| ----- | ----------------------------------------------------------------------------------------- |
| **0** | Separate orgs, profile, seller console chrome, Partnerships landing                       |
| **1** | Catalog CRUD, Integrations verify + snippet, buyer directory (listed by default, opt-out) |
| **2** | Pay-time bind, Activity from real pays, Test as agent, partner password reset             |
| **3** | Optional hosted paywall, analytics, negotiated prices                                     |

## Integrate modes

| Mode           | When                                                  |
| -------------- | ----------------------------------------------------- |
| BYO            | Seller already serves x402 — verify + catalog         |
| Snippet        | Paste Express/`@x402` middleware generated from offer |
| Hosted paywall | Only if BYO churn is high                             |

## Seller features (API scaffolded)

All under `partnerRoute` unless noted. Tables: `seller_usage_events`, `seller_access_policies`, `seller_invoices`, `seller_usage_alerts`; new `offers` columns `version`, `deprecated_at`, `sunset_at`, `successor_offer_id`, `directory_listed` (default 1), `sandbox_enabled` (default 1).

| Feature                              | API                                                                                                                                                                                                                              | Status                                                                                      |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| List once, auto-publish to directory | `POST /v1/seller/offers/:id/publish`, `PATCH … { directoryListed }`, public `GET /v1/directory/offers`                                                                                                                           | Done (opt-out)                                                                              |
| Usage analytics                      | `GET /v1/seller/analytics?days=` — per offer calls by mode, revenue, unique/top buyers + agents, daily series                                                                                                                    | Done; fed from buyer `pay_api` settlements matched by endpoint URL                          |
| Invoicing + payouts                  | `POST /v1/seller/invoices/generate` (idempotent per period, defaults to last UTC month), `GET /v1/seller/invoices`, `GET /v1/seller/payouts`                                                                                     | Manual trigger; no scheduled job yet. Payout = direct x402 settlement to the payout address |
| Rate limits + access policies        | `GET/POST /v1/seller/policies`, `DELETE /v1/seller/policies/:id`                                                                                                                                                                 | Evaluated on sandbox calls; **not yet enforced before buyer pay**                           |
| Versioning + deprecation             | `POST /v1/seller/offers/:id/versions`, `POST /v1/seller/offers/:id/deprecate` (≥ 7 days notice, optional successor)                                                                                                              | Done; offers drop out of the directory after sunset                                         |
| Buyer sandbox                        | public `POST /v1/sandbox/offers/:id/try` — simulated 402 + unlock, no money                                                                                                                                                      | Done; caller ids are self-declared                                                          |
| Webhooks                             | `GET/POST /v1/seller/webhooks`, `DELETE /v1/seller/webhooks/:id`; events `seller.payment.received`, `seller.usage.threshold`, `seller.policy.changed`, `seller.offer.deprecated`; alerts via `GET/POST/DELETE /v1/seller/alerts` | Done; reuses the signed, retried org webhook dispatcher                                     |

## Exit criteria

Partner lists offers, verifies x402 on their site; a buyer-org agent pays on Base Sepolia; partner sees the tx on **Activity**.
