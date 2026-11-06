# Marketplace pre-build audit (M0)

**Baseline commit:** `2703595` (PR #118, products spike)  
**Branch:** `cursor/market-m0-audit-bc8b`  
**Date:** 2026-11-06 (Europe/Paris)  
**Scope:** Part 4 of the marketplace brief. Behaviour changes in this phase are limited to tests, docs, the `marketplaceDb()` export, and the ESLint import boundary for `apps/api/src/marketplace/**`.

---

## 4.1 Architecture: one Durable Object, one SQLite, one Express app

### Findings

| ID  | Finding                                                                                                                                                                                                                                        | File:line                                                                   | Severity                                                       |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------- |
| A1  | All HTTP traffic funnels through a single named DO (`SINGLETON_NAME = "abi-api"`). Catalog browse and ledger writes share one single-threaded actor.                                                                                           | `apps/api-worker/src/worker.ts:15`, `:96–102`                               | blocker for scale; must-fix-before-M3 for read-path protection |
| A2  | Schema DDL runs inside `blockConcurrencyWhile` at DO construction. Long FTS backfills at boot would block the money path.                                                                                                                      | `apps/api-worker/src/worker.ts:60–71`                                       | must-fix-before-M3                                             |
| A3  | `do-sql.ts` maps `transaction` → `transactionSync`. Marketplace CAS (stock reservations) can use this; concurrent Node tests must still assert invariants after each op.                                                                       | `apps/api-worker/src/storage/do-sql.ts`                                     | later (M1/M4)                                                  |
| A4  | Alarm jobs share a ~60 s tick; free-plan DO rows-written quota is 100k/day. New marketplace jobs must be bounded per tick.                                                                                                                     | `apps/api/src/jobs/alarm-runner.ts:1–7`, `docs/CLOUDFLARE-WORKERS.md:30–39` | must-fix-before-M1 (job design)                                |
| A5  | `store.ts` (~9.4k lines) and `index.ts` (~3.1k) already register many route modules. Dropping marketplace SQL/handlers into them couples treasury review to catalog work.                                                                      | `apps/api/src/store.ts`, `apps/api/src/index.ts:670–679`                    | must-fix-before-M1                                             |
| A6  | Web → API proxy: `maxDuration = 60`, fetch timeout 55 s. Marketplace search must stay well under this.                                                                                                                                         | `apps/web/src/app/abi-api/[...path]/route.ts`                               | later                                                          |
| A7  | Cloudflare Free (documented in-repo): DO storage 5 GB/account; rows written 100k/day; 100k Worker/DO requests/day; DO CPU 30 s/request. Current Cloudflare published limits should be re-checked before enabling public catalog in production. | `docs/CLOUDFLARE-WORKERS.md:30–39`                                          | later                                                          |

### Decisions

1. **Module boundary (M0/M1):** all marketplace code lives under `apps/api/src/marketplace/`. ESLint `no-restricted-imports` forbids `@policyvault/ledger`, `@policyvault/custody`, `../rails/**`, `../chain/**` (except an explicit allowlist of read-only helpers in later phases). Enforced in M0.
2. **Storage access (M0):** additive `marketplaceDb()` export in `store.ts` for marketplace-only modules. DDL stays in `store.ts` under `// ---- Marketplace (additive) ----` from M1 onward. Data access via `marketplaceStore` (M1).
3. **Read-path protection (M3):** page size ≤ 50, query ≤ 200 chars, sanitised FTS tokens, in-memory LRU cache (TTL 30 s + catalog version), `recordObs` timing.
4. **Scaling path (documented, not built):** ADR `docs/adr/2026-11-marketplace-catalog-storage.md`. Build a second DO only if measured p95 > 300 ms on 10k products.
5. **Jobs:** marketplace jobs get their own names in `JOBS`, max N rows/tick (M1+).

### Baseline measurements (local better-sqlite3)

Script: `apps/api/scripts/market-m0-baseline.mjs` (seeded ephemeral DB).

| Scenario                                                 | n             | p50                       | p95                       | notes                                                  |
| -------------------------------------------------------- | ------------- | ------------------------- | ------------------------- | ------------------------------------------------------ |
| Seed 10k products + insert                               | 10_000 rows   | —                         | —                         | ~bytes/product ≈ name+desc+attrs (~0.5–2 KB) + indexes |
| Filtered list by category (indexed `category`)           | 25-row page   | recorded in script output | recorded in script output | prototype of public list                               |
| `includes()`-style directory filter over all offers (JS) | all published | recorded                  | recorded                  | pins today’s directory smell                           |
| Guardian summary hot path (existing)                     | 1 org         | recorded                  | recorded                  | money-path neighbour                                   |

Numbers from a local run (2026-11-06, Europe/Paris; also in `docs/marketplace/baseline-m0.json`):

| Metric                                       | Value            |
| -------------------------------------------- | ---------------- |
| Seed 10k products                            | 77.2 ms          |
| List by category LIMIT 25 p50 / p95          | 0.027 / 0.036 ms |
| JS `includes()` over all 10k names p50 / p95 | 8.84 / 17.35 ms  |
| ≈ bytes / product (25-row JSON sample)       | ~236 B           |

Local better-sqlite3 is not DO latency; the JS full-scan filter already shows why FTS + SQL filters matter before public search (M3). Re-run the script before claiming M3 SLOs.

### Phase mapping

| Decision                                  | Phase                              |
| ----------------------------------------- | ---------------------------------- |
| ESLint boundary + `marketplaceDb()`       | **M0**                             |
| `marketplace/` modules + DDL block + jobs | **M1**                             |
| FTS + cache + caps                        | **M3**                             |
| CatalogIndex DO                           | only if SLO fails (owner approval) |

---

## 4.2 Data model: org vs vendor vs buyer, products and orders

### Findings

| ID  | Finding                                                                                                                                             | File:line                                                 | Severity           |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------ |
| D1  | Spike `products.org_id` is whoever called guardian create — typically a **buyer** org. `vendor_id` is free text with no FK.                         | `store.ts:2075–2092`, `7063+`; `listings-routes.ts:70–72` | blocker → M1       |
| D2  | Dual catalogs: `offers` (x402, seller orgs) vs `products` (spike). Different price column names and statuses.                                       | `sellerStore` offers; `products`                          | blocker → M1       |
| D3  | No carts, orders, reservations, reviews, disputes, escrow holds.                                                                                    | —                                                         | M4–M7              |
| D4  | No price freeze / versioning; stock is a plain integer (oversell under concurrency).                                                                | `products.stock_level`                                    | M1 tables; M4 CAS  |
| D5  | Prisma generator selects `sqlite_master` `type='table'`. FTS5 virtual + shadow tables (`*_data`, `*_idx`, …) would enter the mirror unless skipped. | `apps/api/scripts/gen-prisma-schema.mjs:67–71`            | must-fix-before-M3 |

### Decisions (recorded as ADRs)

1. **Vendor = seller org** (`orgs.kind = 'seller'`) with 1:1 `vendors` row. **Buyer = buyer org.** Refuse `SELF_PURCHASE` when `buyerOrgId === vendorOrgId`. → ADR-001
2. **Products over offers for discovery:** `kind='api'` products link `offer_id`; offer remains the payable x402 resource. Directory `/v1/directory/offers` unchanged. Backfill job in M1. → ADR-002
3. Evolve `products` additively (`vendor_org_id`, `status`, `version`, `slug`, …). Spike buyer-owned rows stay `draft` / `vendor_org_id NULL`. Deprecate guardian write for publish.
4. Commerce entities land in M4–M7 as specified in the brief.
5. Price/version freezing via `product_versions` + order-line snapshots (M1/M4).
6. FTS skip-list in generator + drift test (M3).

---

## 4.3 Auth: guardians, agents, partners, public catalog

### Findings

| ID    | Finding                                                                                    | File:line                    | Severity                           |
| ----- | ------------------------------------------------------------------------------------------ | ---------------------------- | ---------------------------------- |
| Auth1 | Spike product writes use `guardianRoute` — buyer credentials can create “vendor” products. | `listings-routes.ts:64–90`   | blocker → M1                       |
| Auth2 | Partner accounts have no roles; every partner can change payout (MFA helps).               | `partner-auth-routes.ts`     | M2                                 |
| Auth3 | Agent scopes are `read` / `pay` / `escrow` only. No `market:*`.                            | `index.ts:509–534`           | M1/M4                              |
| Auth4 | Public directory already exposes seller offers without auth; filter is JS `includes()`.    | `seller-routes.ts:1026–1038` | M3 replaces search; directory kept |
| Auth5 | `scopedStore` assumes single-owner rows; orders/disputes need two-party readers.           | `store.ts:8210+`             | M4+                                |

### Decisions → ADR-003

1. Keep three principals; add `vendorRoute` on `partnerRoute` + `partner_roles` (M2).
2. Agent scopes `market:read|cart|checkout` additive; full `pv_agent_` keys get all three without editing `authAgent` (helper in marketplace).
3. Public catalog via `publicProductView` whitelist only; drafts never public.
4. Two-party getters return 404 (not 403) on mismatch.
5. CSRF stays on cookie mutations via existing wrappers.

---

## 4.4 Billing and payments

### Findings

| ID   | Finding                                                                                                   | File:line                      | Severity                   |
| ---- | --------------------------------------------------------------------------------------------------------- | ------------------------------ | -------------------------- |
| Pay1 | Policy/approvals/session budget are **per intent**. Multi-vendor carts need pre-flight of the whole cart. | `index.ts:800+` `handleIntent` | M4                         |
| Pay2 | Hosted x402 pays straight to `seller_profiles.payout_address` — no on-chain escrow today.                 | `seller-x402.ts` (frozen)      | M7 bookkeeping escrow      |
| Pay3 | Existing `escrows` are intra-org agent↔agent ledger only.                                                 | `engine.ts` settleEscrow       | do not reuse for cross-org |
| Pay4 | `fee_micro` on invoices is informational; no marketplace fee charged.                                     | seller invoices                | M4 record 0 bps            |
| Pay5 | No link from settlement → cart line except URL/amount.                                                    | —                              | M4 reconcile job           |

### Decisions → ADR-004

1. Cart pre-flight (simulate + budgets + compliance) before money moves.
2. One cart-level approval when needed; per-line `pay_api` still applies.
3. Agent-driven payments via ephemeral ABI-hosted offers + ordinary `pay_api`.
4. Default escrow mode for multi-vendor; fees stay 0.
5. Reconcile job matches `settlement_attempts` / `seller_settlements`.

**Open question (owner):** if policy merchant caps key by ABI API host for every hosted pay URL, per-vendor caps must live in marketplace pre-flight — do not change `packages/policy`. Confirm after inspecting `x402ExpectationFor` / `rulesFor` in M4.

---

## 4.5 KYC/KYA for vendors

### Findings

| ID  | Finding                                                                             | File:line                | Severity                                 |
| --- | ----------------------------------------------------------------------------------- | ------------------------ | ---------------------------------------- |
| K1  | Compliance routes are guardian-only; seller orgs cannot submit KYC.                 | `compliance-routes.ts`   | M2                                       |
| K2  | Payout address is syntax-checked (`isAddress`) only — no ownership proof.           | seller profile PATCH     | M2                                       |
| K3  | Unverified vendors can publish offers today; products spike has no publish gate.    | offers flow              | M2 tiers                                 |
| K4  | `baselineCaps()` $25/payment $100/day for unverified buyers will refuse many carts. | `kyc-kya.ts:286`, `:331` | product honesty + M4 pre-flight messages |

### Decisions → ADR-005

Reuse `org_kyc` + `evaluateKyc` on seller side; `vendors.tier` gates publish/sales; EIP-191 payout proof; domain proof via existing ownership helpers. No third-party identity providers.

---

## 4.6 Assistant

### Findings

| ID    | Finding                                                  | File:line                                   | Severity |
| ----- | -------------------------------------------------------- | ------------------------------------------- | -------- |
| Asst1 | No shopping intents/tools; answers are text.             | `abi-agent/intent.ts`, `tools.ts:13`        | M8       |
| Asst2 | Read-only contract is explicit — must preserve.          | `abi-agent/index.ts:396`, `llm-loop.ts:257` | M8       |
| Asst3 | LLM optional via `ABI_CHAT_LLM`; tests must keep it off. | `ai-settings.ts`                            | M8 / CI  |

### Decisions

Shopping tools + cards in M8; purchases are proposals → guardian confirm → one-shot `pay_api` subscriptions. Never call rails from the Assistant.

---

## 4.7 Observability, abuse, security, test gaps

### Findings

| ID  | Finding                                                                                              | File:line                     | Severity                |
| --- | ---------------------------------------------------------------------------------------------------- | ----------------------------- | ----------------------- |
| S1  | In-memory `rateWindows` resets on DO eviction; public search can be scraped.                         | `index.ts:360–391`            | M3 `MARKET_LIMITS` copy |
| S2  | CSP `img-src 'self' data: blob:` blocks remote product images.                                       | `apps/web/next.config.mjs:30` | M9 / image allowlist    |
| S3  | SSRF guards exist (`outboundUrlProblem`) — must wrap vendor URLs.                                    | `outbound-url.ts:112`         | M1+                     |
| S4  | No tests for public projection leaks, FTS injection, stock races, checkout FSM, escrow compensation. | —                             | phased with Areas       |
| S5  | Money-layer freeze needs a machine-checkable guard.                                                  | Area 7                        | **M0**                  |

### Decisions

1. Frozen-file SHA-256 manifest + guard test (M0).
2. Marketplace metrics via `recordObs` (each phase).
3. Image host allowlist env; no blanket `https:` in CSP (M9).
4. SECURITY.md Marketplace section (M1 or with first public routes).

---

## Test gaps closed in M0

- `marketplace/money-layer-guard.test.ts` — frozen hashes + import boundary.
- `marketplace/products-isolation.test.ts` — pins spike cross-org 404 and buyer-owned product invisibility contract for future public queries.
- ESLint restricted imports for `apps/api/src/marketplace/**`.

---

## Cloudflare limits (recorded from in-repo docs; re-verify before prod flag-on)

From `docs/CLOUDFLARE-WORKERS.md` (Free plan notes):

- Requests: 100k/day
- DO CPU: 30 s/request
- DO duration: 13k GB-s/day
- DO rows written: 100k/day
- Subrequests: 50/request
- DO storage: 5 GB / account

Estimate: ~1–2 KB/product public fields + FTS row ≈ plan for ~1–2M products before storage pressure; rows-written and single-DO latency fail first.

---

## Acceptance (M0)

- [x] This audit (sections 4.1–4.7)
- [x] ADRs for identity, catalog, auth scopes, checkout/payments, vendor tiers, catalog storage
- [x] Baseline script (+ optional JSON output)
- [x] `marketplaceDb()` export
- [x] ESLint marketplace import boundary
- [x] Frozen manifest + guard + isolation tests
- [ ] No behaviour change beyond the above
