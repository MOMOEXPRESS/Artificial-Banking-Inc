# Full product audit — website + console

**Date:** 2026-07-25  
**Scope:** Marketing (`/`, `/about`, `/pricing`, `/docs`) + Guardian Console (`/console`) + embedded `/abi-api` on Vercel + guardian auth path  
**Method:** Code review of current `main` (`5f7138c`), cross-check with `docs/GO_LIVE.md`, `docs/REAL-ORG-START.md`, prior audits  
**Not in scope this pass:** Live browser click-through on production (no guaranteed preview), redesign

---

## Executive verdict

The product’s **money spine is mostly real**, but production-on-Vercel durability and several **copy ↔ API mismatches** will make operators think the system is broken or that money moved when it did not.

**Most likely explanation for “401 Unauthorized when logging in with key”:** the guardian key is fine; the **shared embed SQLite** no longer has that org (demo wipe, cache race/loss, or pepper mismatch), and the console **hard-signs-out on any `/org` 401**.

| Band | Count | Theme |
|------|------:|-------|
| **P0** | 6 | Auth durability, demo wipe, misleading Send, stuck skeleton, dead `?demo=1` |
| **P1** | 12 | Success-without-`res.ok`, Sync/Refresh drift, empty-org UX, pricing/docs lies |
| **P2** | 10 | Poll races, a11y/mobile, error swallowing |
| **P3** | 6 | Copy nits, dead selectors, SEO |

---

## Severity legend

| Level | Meaning |
|-------|---------|
| **P0** | Blocks login/trust, loses data, or lies about money movement |
| **P1** | Significant operator confusion or silent failure |
| **P2** | Annoyance / lag / inconsistency with workaround |
| **P3** | Polish |

---

## P0 — Critical

### A1. Login key → 401: embed DB not durable + concurrent hydrate race
**Where:** `apps/web/src/app/abi-api/[...path]/route.ts`, `apps/web/src/lib/vercel-db-sync.ts`  
**Impact:** Valid `pv_guardian_…` keys return **401** after create/demo on another isolate, after Demo wipe, or after cache loss.  
**Cause:** Every request `closeDb` → overwrite `/tmp` from Runtime Cache → serve → last-write-wins persist. No mutex, no CAS. Persist failures are warnings only. TTL 7 days.  
**Fix direction:** Mutex around hydrate/serve/persist; never overwrite newer local DB; durable external API for anything beyond a personal demo; health-check empty DB.

### A2. Demo bootstrap wipes **all** orgs; embed defaults bootstrap **on**
**Where:** `apps/api/src/store.ts` `bootstrapDemo`, `abi-api/.../route.ts` `ensureEmbedEnv`  
**Impact:** One “Demo” click deletes every org/key in the shared SQLite. Real keys in `localStorage` then 401.  
**Cause:** Unauthenticated wipe; `POLICYVAULT_ALLOW_BOOTSTRAP` forced to `1` when unset on Vercel.  
**Fix direction:** Default bootstrap **off** in production; refuse wipe if non-demo orgs exist; isolate demo DB.

### A3. Console hard sign-out on any `/v1/guardian/org` 401
**Where:** `apps/web/src/app/console/page.tsx` ~396–399  
**Impact:** Transient empty-DB races delete `pv_session` and force login (“Guardian key rejected”).  
**Fix direction:** Retry 1–2× before logout; only clear session after N consecutive 401s; distinguish “unknown key” vs “API unavailable”.

### A4. `ABI_KEY_PEPPER` defaults diverge (local vs Vercel embed)
**Where:** `apps/api/src/secrets.ts` (`abi-dev-pepper-change-me`), embed route (`abi-vercel-demo-pepper`)  
**Impact:** Same plaintext key hashes differently → permanent 401 across environments; rotating pepper orphans all keys.  
**Fix direction:** Single required pepper in prod (fail closed); never invent a second demo pepper; document wipe-on-rotate.

### A5. Treasury **Send** looks on-chain; API is ledger-only
**Where:** `apps/web/src/lib/treasury-view.tsx` (Send / “Sent … from the vault”) vs `POST /v1/guardian/treasury/withdraw`  
**Impact:** Operators believe USDC left the vault on Base; journal-only debit. Real on-chain path is Playground / agent `POST /v1/agent/pay`.  
**Fix direction:** Relabel to “Ledger debit”; success copy must say not on-chain; keep agent-pay as the E2E proof path.

### A6. First poll failure → infinite skeleton
**Where:** `apps/web/src/app/console/page.tsx` `refreshFast` — `setLoading(false)` only on success; `catch` only sets `connected=false`  
**Impact:** After login, a single network blip leaves the console on `ConsoleSkeleton` forever.  
**Fix direction:** Always clear loading; show reconnect / retry empty state.

---

## P1 — High

### B1. `/console?demo=1` is a no-op
Linked from home, docs, footer, CTA. Console never reads `demo`. Lands on login default **Create org**.  
**Fix:** `login-view` reads `?demo=1` → set mode Demo (and optionally auto-bootstrap with confirm).

### B2. Embed defaults fight GO_LIVE / REAL-ORG-START
Create org needs `POLICYVAULT_ALLOW_PUBLIC_ORG_CREATE=1` (not auto-set). Bootstrap defaults on. Marketing pushes Create + Demo; prod harden wants opposite.

### B3. Guardian key paste only `trim()`s
Pasting `Bearer pv_guardian_…`, quotes, or markdown backticks → opaque 401.  
**Fix:** `normalizeGuardianKey()` shared helper + clearer toast.

### B4. Mutations toast success without `res.ok`
Freeze/unfreeze (Overview + Agents), webhook delete, and similar paths call `act(...)` and return success strings without checking HTTP status.

### B5. Approvals animate away before API completes
Failed approve/deny: card already gone; returns only on next poll (~8s).

### B6. “Demo books only” shown for all USDC orgs
Receive/Send card always claims demo books when `asset_usdc`, including real orgs.

### B7. Copy still says **Sync**; UI says **Refresh** / **Force re-scan**
Fund helpers + Settings Go-live. Auto-credit every ~25s is easy to miss.

### B8. Ledger shows **DRIFT** while `recon` is still null
`"undefined bad"` until 90s reconcile (or forever if recon fails silently).

### B9. Insights skeleton forever on fetch failure
`loaded` only set on success; empty `catch`.

### B10. Marketing wrong key prefixes
Home How-it-works shows `gsk_…` / `agk_…`; real are `pv_guardian_…` / `pv_agent_…`.

### B11. Pricing matrix denies features the free console already has
Developer row claims no production USDC / webhooks / etc. Team/Enterprise CTAs → `/about` with no contact.

### B12. GitHub “View source” 404 for anonymous users
Repo is private; public marketing links to GitHub 404.

---

## P2 — Medium

### C1. Overlapping polls, no AbortController
Shell 8s/30s/90s + Insights 20s + Chat 15s + Agents 15s + Fund on-chain 25s. Stale responses can overwrite newer state; some fingerprints omit amounts.

### C2. Re-login with key clears `agentKeys` in localStorage
`connect()` always passes `agentKeys: []`.

### C3. Mobile rail: no Escape-to-close / focus trap; tight burger vs crumb

### C4. Connection “live” lies for viewer/approver when `connected === false`

### C5. Error swallowing
`refreshSlow` empty catch; Chat silent `!res.ok`; Activity CSV silent fallback; several view refreshes lack try/catch.

### C6. setState after unmount (Chat, Treasury on-chain, Agents roster)

### C7. Global `busy` serializes entire console during one `act()`

### C8. `NEXT_PUBLIC_SELLER_URL` defaults to `localhost:9402` on Vercel
x402 Playground missions break unless overridden.

### C9. Docs list `/v1/...` without `/abi-api` (or absolute API) base

### C10. Metrics band: “7 demo missions” vs 9 in `MISSIONS`; local latency claims as product metrics

---

## P3 — Polish

- LandingMotion targets `.metric-card` but DOM uses `.metric-inline`
- CTA copy drift (“Launch” vs “Open the console”)
- Closing CTA implies OpenAI/Anthropic keys; product uses `pv_agent_…`
- Overview empty agents / empty decisions copy reads as “healthy” for brand-new real orgs
- Playground empty state points to Overview; Agents is the fuller create path
- Root metadata only; marketing pages are client components without per-route titles

---

## What is working (do not “fix”)

- Org derived from guardian key, not body (`authGuardianCtx`)
- Hash-at-rest + plaintext migration path for keys
- Relative `/abi-api` correctly selects embed when no absolute API URL
- Login does not write session on failed connect
- Key reveal + ack gate on create/demo
- Real org starts with **0 agents**; demo seeds Researcher/Writer (by design)
- Agent on-chain pay rail exists (`POST /v1/agent/pay`) and is documented as the E2E proof — distinct from Treasury Send
- CSS brace balance OK; marketing image paths under `public/` resolve

---

## 401 login — ordered hypotheses (ops)

1. Someone ran **Demo** (or cache race) and wiped/lost the org that issued the key  
2. **Pepper** changed or differs between where the key was created and where you paste it  
3. Paste included **`Bearer ` / quotes / markdown**  
4. Client points at a **different API** than the issuer (`NEXT_PUBLIC_API_URL` / `ABI_API_ORIGIN`)  
5. Console saw a **transient 401** and deleted `pv_session` (A3)

**Immediate operator workaround:** Create a new org (if public create enabled), save the new key, do **not** click Demo on a shared embed; or run a durable external API with fixed `ABI_KEY_PEPPER` + persistent `POLICYVAULT_DB`.

---

## Recommended fix order

1. **A6** skeleton forever (small, high leverage)  
2. **A3** soft 401 retry before sign-out  
3. **B1** honor `?demo=1`  
4. **B3** key paste normalize + clearer 401 message  
5. **A5 / B6 / B7** money-path honesty (Send / Sync / demo-books)  
6. **A2 / B2** align embed defaults with GO_LIVE (bootstrap off, public create on for launch)  
7. **A1 / A4** durability + single pepper (larger; may need external API)  
8. **B4 / B5 / B8 / B9** mutation/error honesty  

---

## Related docs

- `docs/GO_LIVE.md`, `docs/REAL-ORG-START.md`, `docs/VERCEL.md`  
- `docs/CONSOLE-CONSISTENCY-AUDIT.md` (2026-07-21 — many honesty items claimed fixed; **A5 Send / Sync / dual queues** still need re-verification)  
- `docs/AUDIT-FINDINGS.md` (security A1–A13; mostly fixed)  
- `docs/E2E-ONCHAIN-AGENT-PAY.md` (correct proof path)
