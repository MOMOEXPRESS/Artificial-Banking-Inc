# Seller partnership plan

**Status:** Seller console + catalog in progress  
**Locked / clarified decisions:**

1. **Force separate seller org** for partners (`Acme Buyer` ≠ `Acme Seller`).
2. **Private discovery** — agents find products on the **seller’s own site**; ABI is the payment unlock path, not a public marketplace directory.
3. **BYO + snippet** over hosted paywall (hosted deferred if BYO churn is high).
4. **Buyer console stays buyer-only.** Seller gets a **dedicated seller console** (same design system), entered from marketing **Partnerships** → seller login.

## Product thesis

- **Buyer console** (`/console`): agent treasuries, policy, approvals, spend.
- **Seller console** (`/seller`): catalog, x402 integrate, inbound activity.

```text
Seller site (private) → agent hits paid resource → x402 / ABI challenge
→ agent’s buyer org policies + pay_api → USDC to seller wallet → resource unlocks
→ seller sees settlement on Activity
```

Money settles USDC to the **seller wallet** via the x402 facilitator. ABI does not custody seller funds.

## Org model

| Rule | Detail |
|------|--------|
| `orgs.kind` | `buyer` (default) or `seller` — security boundary |
| Same user | May hold memberships in both |
| Buyer org | Refuses `workspace=seller\|both` — must create a seller org |
| Entry | `/partnerships` marketing → `/seller` login (same accounts as buyer) |

## Seller navigation

| Nav | Purpose |
|-----|---------|
| **Overview** | Profile readiness, offer counts, next actions |
| **Catalog** | Offers (SKU / endpoint / price) — unit agents pay for |
| **Integrations** | BYO verify + snippet for each offer |
| **Activity** | Inbound settlements / payments |
| **Developers** | Snippets, challenge shape, webhook notes |
| **Settings** | Seller profile + payout wallet |

## Schema

```sql
ALTER TABLE orgs ADD COLUMN kind TEXT NOT NULL DEFAULT 'buyer';

CREATE TABLE seller_profiles (...);
CREATE TABLE offers (...);                 -- catalog
CREATE TABLE offer_integrations (...);     -- verify / snippet state
CREATE TABLE partnerships (...);           -- optional buyer↔seller links (later)
CREATE TABLE seller_settlements (...);     -- activity (later fill from pay path)
```

## Phases

| Phase | Scope |
|-------|--------|
| **0** | Separate orgs, profile, seller console chrome, Partnerships landing |
| **1** | Catalog CRUD, Integrations verify + snippet, private (no public directory) |
| **2** | Pay-time bind, Activity from real pays, Test as agent |
| **3** | Optional hosted paywall, analytics, negotiated prices |

## Integrate modes

| Mode | When |
|------|------|
| BYO | Seller already serves x402 — verify + catalog |
| Snippet | Paste Express/`@x402` middleware generated from offer |
| Hosted paywall | Only if BYO churn is high |

## Exit criteria

Partner lists offers, verifies x402 on their site; a buyer-org agent pays on Base Sepolia; partner sees the tx on **Activity**.
