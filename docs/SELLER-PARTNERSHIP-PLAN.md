# Seller partnership plan

**Status:** Phase 0 in progress (preview PR)  
**Locked decisions (2026-10-26):**

1. **Force separate seller org** for partners (`Acme Buyer` ≠ `Acme Seller`).
2. **Early directory** — public discovery stub lands with Phase 0; full marketplace later.
3. **BYO + snippet** over hosted paywall (hosted deferred to Phase 3 if BYO churn is high).
4. **Do both** — this ticket/schema draft **and** a Phase 0 preview PR.

## Product thesis

ABI sells distribution + gated agent spend to buyers, and “get paid by agents” infrastructure to sellers.

Partnership = catalog + verified x402 + buyer policy path + inbound sales analytics.

```text
Partner signup → seller profile → offers → BYO/snippet x402 → verify → publish
→ buyer allowlist/partnership → agent pay_api → USDC to seller → seller_settlements
```

Money settles USDC to the **seller wallet** via the x402 facilitator. ABI does not custody seller funds.

## Org model

| Rule | Detail |
|------|--------|
| `orgs.kind` | `buyer` (default) or `seller` — security boundary |
| Same user | May hold memberships in both a buyer org and a seller org |
| Workspace field | Nav hint only; buyer orgs **refuse** `workspace=seller\|both` |
| Existing `merchants` | Stay buyer-side vendor metadata; do not overload for seller catalog |

Creating a seller path always spawns a dedicated `kind=seller` org (never reuses the buyer float).

## Schema draft (additive SQLite)

### Phase 0

```sql
ALTER TABLE orgs ADD COLUMN kind TEXT NOT NULL DEFAULT 'buyer';

CREATE TABLE IF NOT EXISTS seller_profiles (
  org_id TEXT PRIMARY KEY REFERENCES orgs(id),
  display_name TEXT NOT NULL,
  payout_address TEXT,
  network TEXT NOT NULL DEFAULT 'base-sepolia',
  status TEXT NOT NULL DEFAULT 'draft', -- draft | ready
  website TEXT,
  description TEXT,
  updated_at TEXT NOT NULL
);
```

### Phase 1–2 (not created in Phase 0)

```sql
CREATE TABLE IF NOT EXISTS offers (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  endpoint_url TEXT NOT NULL,
  price_usdc_micro TEXT NOT NULL,
  network TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft', -- draft | verified | published | paused
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(org_id, slug)
);

CREATE TABLE IF NOT EXISTS offer_integrations (
  offer_id TEXT PRIMARY KEY REFERENCES offers(id),
  last_challenge_json TEXT,
  snippet_version TEXT,
  last_verified_at TEXT,
  error TEXT
);

CREATE TABLE IF NOT EXISTS partnerships (
  id TEXT PRIMARY KEY,
  seller_org_id TEXT NOT NULL REFERENCES orgs(id),
  buyer_org_id TEXT NOT NULL REFERENCES orgs(id),
  offer_id TEXT REFERENCES offers(id),
  status TEXT NOT NULL DEFAULT 'invited', -- invited | active | revoked
  negotiated_price_micro TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(seller_org_id, buyer_org_id, offer_id)
);

CREATE TABLE IF NOT EXISTS seller_settlements (
  id TEXT PRIMARY KEY,
  seller_org_id TEXT NOT NULL REFERENCES orgs(id),
  offer_id TEXT REFERENCES offers(id),
  buyer_org_id TEXT,
  amount_micro TEXT NOT NULL,
  tx_hash TEXT,
  state TEXT NOT NULL, -- pending | settled | failed
  created_at TEXT NOT NULL
);
```

`seller_settlements` exists because buyer activity is scoped to the buyer that registered a URL; partners need **all inbound pays to their offers across buyers** (redacted: no buyer keys/budgets).

## Tickets

### Phase 0 — IA + auth (`SP-0`)

| ID | Work |
|----|------|
| SP-0.1 | `orgs.kind` + `seller_profiles` migrations |
| SP-0.2 | `POST /v1/seller/orgs`, `GET\|PATCH /v1/seller/profile` |
| SP-0.3 | Auth/membership payloads expose `kind`; `/v1/guardian/org` includes `kind` |
| SP-0.4 | Refuse `workspace=seller\|both` on buyer orgs → `SELLER_ORG_REQUIRED` |
| SP-0.5 | Stub `GET /v1/directory/offers` → `[]` |
| SP-0.6 | `/seller` shell, `/seller/settings` profile, Buyer \| Seller switcher |
| SP-0.7 | Public `/directory` stub page |

**Out of scope:** offers CRUD, verify/publish, settlements, partnerships, snippet codegen, pay-time bind.

### Phase 1 — Catalog + verify (`SP-1`)

- Offers CRUD under `/v1/seller/offers`
- Verify unpaid GET matches required x402 V2 shape
- Publish / pause
- Snippet v0 (Express / `@x402/express`)
- Migrate Merchant Gateway “verify endpoint” UX into seller **Integrate**

### Phase 2 — Closed loop (`SP-2`)

- Settle → `seller_settlements`, `/seller/payments`
- Pay-time bind: `challenge.payTo === offer.payout_address`, amount ≤ offer/partnership price, network/asset match
- “Test as agent” from seller console
- Partnership invite → buyer allowlist helper

### Phase 3 — GTM (`SP-3`)

- Searchable directory, webhooks, analytics
- Optional hosted paywall if BYO churn is high
- Negotiated prices at scale

## Integrate modes

| Mode | Seller effort | ABI delivers | When |
|------|---------------|--------------|------|
| BYO | Already has x402 | Verify + catalog + payments | Phase 1 |
| Snippet/SDK | Paste generated middleware | Offer→config codegen + test pay | Phase 1–2 |
| Hosted paywall | Point origin at `pay.abi…/o/:offerId` | ABI terminates 402 | Phase 3 only if needed |

## API map (target)

### Phase 0

- `POST /v1/seller/orgs` — create seller org for signed-in user
- `GET\|PATCH /v1/seller/profile` — seller-kind org only
- `GET /v1/directory/offers` — public stub

### Phase 1+

- `/v1/seller/offers`, `/v1/seller/offers/:id/verify`, `/v1/seller/offers/:id/publish`
- `/v1/seller/payments`, `/v1/seller/customers`
- `/v1/seller/partnerships`

## Frontend map

| Path | Phase | Purpose |
|------|-------|---------|
| `/seller` | 0 | Overview shell |
| `/seller/settings` | 0 | Profile + payout wallet |
| `/directory` | 0 | Early discovery stub |
| `/seller/offers*` | 1 | Catalog + integrate |
| `/seller/payments` | 2 | Inbound settlements |
| `/seller/customers` | 2 | Partnerships |

Buyer console (`/console`) and seller shell stay separate; header switcher links between them.

## Exit criteria (end of Phase 2)

Partner lists 3 offers, verifies x402; a separate buyer-org agent pays on Base Sepolia; partner sees the tx on `/seller/payments` within seconds.

## Relation to existing surfaces

- Buyer **Settings → Merchants** / `/v1/guardian/merchant-gateway/*` remain the buyer-side registration of external sellers.
- `apps/x402-seller` remains the local demo seller for playground / gateway verify — not the product shell.
- See also `docs/NEXT-BUILD-PLAN.md` §4 and `docs/MERCHANT-GATEWAY.md`.
