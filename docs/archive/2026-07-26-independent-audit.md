# ABI (Artificial Banking Incorporated) — Comprehensive Product & Engineering Audit

> **Archived — point-in-time.** Written July 2026. Kept for history; it is not a
> description of the current system and is not maintained. The living documents
> are [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) and
> [`docs/ROADMAP.md`](../ROADMAP.md).

**Date:** 2026-07-26
**Commit audited:** `5f7138c` (`main`, fresh clone of `MOMOEXPRESS/Artificial-Banking-Inc`)
**Repo age:** 108 commits · 116 by "Cursor Agent", 7 by MOMOEXPRESS, 4 by cursor[bot]
**Scale:** ~35.9k LOC TypeScript (14.7k API · 17.3k web · 3.0k packages) · 110 HTTP routes · 49 passing unit assertions
**Method:** Read-only. Full repo read, `npm install` + `npm run build` + per-suite `node --test` executed locally. No code modified. No calls made against the live deployment.

---

## 0. What I did with prior context

I discarded it. The clone is fresh, the working tree untouched, and every conclusion below traces to a file and line in `5f7138c`. Where a previous architectural decision has been replaced (SQLite-behind-`store.ts` instead of Prisma/Postgres; embedded API-in-Next instead of a separate API host), I judged the replacement on its own merits — and in one case the replacement is significantly worse than what it replaced.

---

# EXECUTIVE SUMMARY

ABI is **two products glued together, and they are pulling in opposite directions.**

Underneath is a genuinely good piece of financial engineering: a deterministic policy engine, a real double-entry ledger with balanced-journal and no-negative-balance invariants, an intent execution engine that reserves idempotency *before* execution, re-runs policy *at approval time* rather than trusting a stale decision, and settles partial amounts correctly. Someone thought hard about the money path. The `packages/policy` + `packages/ledger` + `apps/api/src/engine.ts` triangle is the best code in the repo and would survive a real review.

On top of it is a demo that has been dressed as a product and shipped to a public URL under claims it cannot support. The deployment architecture serializes the entire financial database into a **Vercel Runtime Cache entry as a base64 blob on every single HTTP request**, which destroys every concurrency guarantee the engine underneath so carefully establishes. An **unauthenticated, internet-reachable endpoint wipes every organization in the database**, including the private keys of any funded vault. The landing page says "Coinbase CDP holds the keys for you" and the Settings screen reports `custody: cdp` — while `CdpVaultProvider` is a copy of `DevLocalProvider` with a different `name` string, reading a plaintext private key out of SQLite. There is no Coinbase dependency in the monorepo at all.

The gap between what the code does and what the product claims is the single biggest finding in this audit. It is not a technical problem — it is a credibility problem, and for a YC application it is the one that would end the conversation.

### Scores

| Dimension | Score | One-line rationale |
|---|---|---|
| **Overall product** | **4 / 10** | Real, coherent vision with a working demo; cannot be trusted with money and claims capabilities it does not have. |
| **Engineering** | **5 / 10** | Excellent domain core; catastrophic runtime topology; no CI; critical paths untested. |
| **UX** | **6.5 / 10** | Genuinely polished and conceptually well-organised — the strongest dimension. Undermined by screens that promise things the backend doesn't do. |
| **Architecture** | **4 / 10** | Good bounded contexts and extension seams. The deployment model invalidates them. |
| **Security** | **2 / 10** | Unauthenticated destructive endpoint, no authentication system, hot keys in plaintext, root credential in `localStorage`, false custody claims. |
| **Production readiness** | **1.5 / 10** | Not deployable against real funds in its current form. |
| **Likelihood of succeeding with target users (as-is)** | **Low** | An enterprise security review terminates at week one. A developer hits "no npm package, no Python SDK" in hour one. |
| **Likelihood after the Immediate + Before-Beta work below** | **Moderate–good** | The hard part (policy + ledger + HITL semantics) is already built and correct. The blockers are replaceable infrastructure, not a rewrite. |

### Biggest strengths

1. **The policy engine is genuinely correct.** Default-deny, fail-closed, explainable rule IDs on every decision. An empty allowlist never votes "allow" (`packages/policy/src/index.ts:200`) — a subtle trap most teams fall into. Suffix matching is dot-anchored so `api.openai.com.attacker.net` cannot masquerade as `api.openai.com` (`:216`). Band nesting is validated server-side.
2. **The approval semantics are the best-reasoned part of the product.** `resolveApproval` re-evaluates the *current* ruleset at execution time with HITL-summoning rules neutralised but every hard limit intact (`apps/api/src/engine.ts:658-672`). This means a queue of individually-legal approvals cannot collectively blow the daily cap. Very few teams get this right. Quorum counts authenticated identities, not client-supplied labels (`:539`).
3. **The ledger is a real ledger.** Balanced-journal assertion, asset accounts floored at zero with contra accounts exempted, explicit cross-tenant guard, and genesis-replay reconciliation (`packages/ledger/src/index.ts:60-84`, `apps/api/src/store.ts:3299`).
4. **Concurrency discipline in the engine.** Idempotency is *reserved* before the rail runs, not checked-then-written (`apps/api/src/index.ts:474`). Escrow settlement and approval resolution both use compare-and-swap claims. This is the correct instinct.
5. **The x402 client validates everything the seller controls before signing** — token contract pinned per network, `payTo` format- and blocklist-checked, price sanity-checked, validity window clamped regardless of what the seller asks (`apps/api/src/rails/x402.ts:129-171`). Real security thinking.
6. **Clean extension seams.** `CustodyProvider`, `PaymentRail`, `ComplianceScreener`, notifier channels, observability sink. The architecture *anticipates* the real implementations even where it lacks them.
7. **The UI is good.** Coherent visual language, a legible information architecture, deep links, a command palette, keyboard shortcuts, empty states, skeletons, reduced-motion handling. This is not a scaffolded template.

### Biggest weaknesses

1. **The production persistence layer is a cache, not a database** — and it is read-modify-write on every request with no locking.
2. **An anonymous POST deletes every tenant.**
3. **"Coinbase CDP" is a string literal.** No SDK, no dependency, no MPC, no server wallet.
4. **There is no authentication system.** No users, no email, no password, no SSO, no MFA, no sessions, no recovery. A bearer token in `localStorage` is the entire identity model.
5. **Per-agent budgets are not policy-enforced.** One policy per org. "Programmable budgets per agent" — the headline capability — is a ledger allocation and a freeze flag, nothing more.
6. **The README documents a security regression suite (`security.mjs`) that has never existed in any branch.**

---

# 1. UNDERSTANDING THE PRODUCT (Step 1)

**Stated vision:** the financial operating system for autonomous AI agents — create agents, assign programmable budgets, manage org treasuries, define financial policies, require human approvals, execute crypto payments via Coinbase CDP, support x402, provide complete auditability, enterprise-grade security, full visibility over autonomous spending.

**What the repository actually is:** a policy-gated USDC spending-control layer for AI agents, with a real Base ERC-20 transfer rail, a self-contained x402 demo loop, a well-built approvals workflow, and a large, polished single-page guardian console — deployed as a demo whose persistence and custody are not production mechanisms.

**Vision-to-implementation scorecard:**

| Vision capability | Status | Evidence |
|---|---|---|
| Create AI agents | ✅ Real | Full lifecycle: create, rename, profile, freeze, archive, key rotate/revoke, scoped session keys (`agent-routes.ts`) |
| Assign programmable budgets | ⚠️ **Half** | Money envelope: yes (ledger stipend). *Programmable* (per-agent rules): **no** — one `PolicyTemplate` per org (`engine.ts:49`) |
| Manage organization treasuries | ⚠️ Mixed | Real on-chain deposit detection + auto-credit. But "Deposit"/"Withdraw" mint and burn unbacked ledger money (`treasury-routes.ts:552,630`) |
| Define financial policies | ✅ Real, org-scoped | Caps, velocity, allow/blocklists, quiet hours, HITL bands, IF/THEN automation, versioning, restore, replay simulator |
| Require human approvals | ✅ **Best-in-class** | Park → notify → quorum → atomic claim → policy re-check → execute (`engine.ts:529`) |
| Execute crypto payments via Coinbase CDP | ❌ **Not implemented** | Zero Coinbase dependency. `CdpVaultProvider` = `DevLocalProvider` + a renamed `name` field (`packages/custody/src/index.ts:91-120`) |
| Support x402-compatible payment flows | ⚠️ **Closed loop only** | Buyer, seller and facilitator are all ABI's own code. Hand-rolled; the EIP-712 domain is wrong for Base Sepolia (§7.4) |
| Complete auditability | ⚠️ Internal only | Decisions, journals, votes, policy versions, audit export — all good. Reconciliation compares books to books, never to chain (`store.ts:3299`) |
| Enterprise-grade security | ❌ **No** | See §7 |
| Full visibility over autonomous spending | ✅ Strong | Insights, burn forecast, vendor ledger, anomalies, job economics — and the forecast honourably refuses to project from too-short a window |

**Verdict:** roughly **five of ten** vision pillars are real. The two that matter most to the pitch — CDP custody and x402 — are the two that are not.

---

# 2. ARCHITECTURE (Steps 2 & 6)

## 2.1 Shape

```
apps/web (Next 15, App Router)  ──►  /abi-api/[...path]  ──►  Express app (in-process)
      │  100% "use client"                   │                        │
      │  14 polled endpoints                 │                  engine.ts (money)
      │  guardianKey in localStorage         │                  store.ts  (SQLite)
      │                                      │                        │
      └──────────────────────────────────────┴──►  Vercel Runtime Cache (base64 blob)

packages/  common · policy · ledger · custody · sdk · db(Prisma, unwired)
apps/      api · web · mcp-server · worker(13 LOC stub) · demo-agent · x402-seller · mobile(orphaned)
contracts/ AbincToken.sol (fixed-supply ERC-20, explicitly not wired to anything)
```

The **logical** architecture is good: bounded contexts, dependency-inverted seams, money types as branded micro-USDC bigints, all SQL behind one module. The **runtime** architecture is where it falls apart.

## 2.2 The central architectural failure

`apps/web/src/app/abi-api/[...path]/route.ts:102-136` — every single API request executes:

```
closeDb()                        →  release the SQLite handle
hydrateDbFromCache(dbPath)       →  base64-decode the WHOLE database from Vercel Runtime Cache, write to /tmp
reloadDbFromDisk()               →  reopen SQLite
dispatchExpress(...)             →  serve the request
flushDbForPersist()
persistDbToCache(dbPath)         →  base64-encode the WHOLE database, upload to a single global cache key
```

The cache key is a constant: `const CACHE_KEY = "abi-sqlite-v1"` (`vercel-db-sync.ts:8`). One key, all tenants, all orgs, all vault private keys.

Four consequences, each independently disqualifying:

**(a) Guaranteed lost writes under any concurrency.** This is read-modify-write on a shared blob with no CAS, no lease, no version check. Two concurrent requests each hydrate snapshot *N*, apply their own mutation, and each persist. Last writer wins; the other request's journal entries, payments, approvals and idempotency reservations vanish — *after* the caller received an HTTP 200. Every guarantee `engine.ts` establishes (idempotency reserved before execution, atomic approval claim, escrow CAS) is enforced inside a SQLite transaction on a file that is about to be silently overwritten.

This is not a theoretical race. The console itself fires **four concurrent requests every 8 seconds** and nine more every 30 seconds (`console/page.tsx:383-435`). A single logged-in user sitting idle on the dashboard generates continuous concurrent hydrate/persist cycles. The system cannot maintain ledger integrity with *one* user doing *nothing*.

**(b) The system of record is evictable.** Runtime Cache is a cache. TTL is set to 7 days but eviction is at the platform's discretion, and cache scope across deployments is not guaranteed. On eviction: every org, every balance, every audit trail, and — critically — **every vault private key** is gone, and any USDC sitting at those addresses is permanently unrecoverable.

**(c) It does not scale, at all.** Payload grows linearly with total platform history. Base64 adds 33%. Every request pays download + write + open + read + write + read + encode + upload of the entire dataset. At a few hundred orgs this exceeds Vercel's function limits and times out.

**(d) All background work is dead in production.** `apps/api/src/index.ts:2065-2106` gates every `setInterval` behind `if (!embedded)`, and the Vercel path sets `ABI_EMBEDDED=1`. So in production:

| Sweep | Runs in prod? | Consequence |
|---|---|---|
| `runDueSubscriptions` | ❌ **Never** | **Recurring payments silently never charge.** The Subscriptions feature is inert. |
| Reconciliation watchdog | ❌ Never | Drift is only detected if a guardian happens to open the console (90s client poll) |
| `sweepEscrowTimeouts` | ⚠️ Read-triggered only | Escrow auto-refund only fires when someone loads the Escrows tab |
| `sweepApprovalExpiry` | ⚠️ Read-triggered only | Same — expiry is lazy |
| `runOnchainDepositSweep` | ⚠️ Request-triggered | Deposits only credit when a human is looking |
| `startTelegramPolling` | ❌ Never | Telegram approvals are non-functional in production |

The Subscriptions and Telegram features are shipped, documented, and surfaced in the UI, and neither works on the deployed instance.

**Judgment on the architectural change:** the previous direction — separate API process, `packages/db` Prisma/Postgres behind the `store.ts` seam — was **strictly better** and should be restored. The `store.ts` boundary was built precisely so this swap would be cheap. Embedding the API into Next was a deployment convenience that traded away every correctness property the engine provides. This is the one place where I would say plainly: the newer decision is worse, and it should be reverted rather than patched.

## 2.3 Other engineering findings

- **No CI.** The only GitHub workflow (`.github/workflows/vercel-harden.yml`) exists to **disable Vercel Deployment Protection SSO**. There is no test, typecheck, lint, or build gate on `main`. `npm run lint` is literally `echo "lint: add eslint in later pass"` (`package.json:24`). There is no ESLint config anywhere in the repo.
- **Root `npm test` is broken.** From a clean clone it fails (needs a prior build), and after building it hangs indefinitely producing zero output. Cause: `"test": "node --import tsx --test $(find src -name '*.test.ts')"` (`apps/api/package.json`) — a POSIX shell substitution run through npm's `cmd.exe` on the documented Windows dev platform. Every suite passes when invoked individually (28 API + 14 policy + 7 ledger = 49 assertions).
- **`apps/web/src/lib/judgment-bands.test.ts` is not in the root test script at all** — the web workspace has no `test` script.
- **Test coverage is inverted.** 17 of 49 assertions cover the chat agent's intent classifier. **Zero** tests cover `executeIntent`, `resolveApproval`, quorum, the idempotency replay path, the x402 rail, guardian RBAC, webhook signing, or any HTTP route. The most security-critical 900 lines in the repo are untested.
- **Frontend is one giant client bundle.** Every page is `"use client"`; no server components, no SSR data, no streaming. `/console` is 163 kB route + 320 kB first load. `console/page.tsx` is a 1,074-line component holding ~30 `useState` hooks; `treasury-view.tsx` is 1,506 lines; `agents-view.tsx` 1,429. `globals.css` is a single 7,027-line file with 431 inline `style={{}}` objects scattered across components — Tailwind is installed but largely bypassed.
- **`apps/mobile` is orphaned.** Not in `workspaces`, not in the lockfile, not in the build. Single-file Expo app, and the code comment concedes push notifications are unimplemented — which makes a mobile approvals app useless when approvals expire in 10 minutes by default.
- **`apps/worker` is 13 lines.** `packages/db` (Prisma schema, 226 lines) is unwired dead weight.
- **Identity crisis.** `package.json` says `artificial-banking-inc`; `README.md` line 1 says **PolicyVault**; every package is `@policyvault/*`; keys are `pv_guardian_`/`pv_agent_`; webhook headers are `x-policyvault-signature`; the DB is `policyvault.db`; `localStorage` key is `pv_session`; the API logs `PolicyVault API on…`; `docs/INDEX.md` links to absolute paths on a *different machine* (`./…`). A customer integrating webhooks has to write code against a brand that does not appear anywhere in the product.

---

# 3. FUNCTIONAL FINDINGS (Steps 3 & 4)

Severity: **C**ritical · **H**igh · **M**edium · **L**ow · **N**ice-to-have

## CRITICAL

**C1 — Unauthenticated endpoint destroys every organization on the platform.**
`POST /v1/demo/bootstrap` requires no auth (`index.ts:671`). It is gated by `ALLOW_BOOTSTRAP`, which the team correctly defaults off in production — but the Vercel shim defeats the gate: `ensureEmbedEnv()` sets `process.env.POLICYVAULT_ALLOW_BOOTSTRAP = "1"` whenever it is undefined, and runs *before* `await import("@policyvault/api")` evaluates the constant (`route.ts:76-88`). `store.bootstrapDemo()` then `DELETE`s from 34 tables including `orgs`, `accounts`, `journals`, `agents`, and **`vaults`** (`store.ts:3400-3448`). Any anonymous visitor can `curl -X POST https://<host>/abi-api/v1/demo/bootstrap` and permanently erase every tenant's ledger, audit trail, agent keys, and vault private keys. Funded vaults become unrecoverable. The team's own `docs/AUDIT-FINDINGS.md` marks the sibling issue (A3) as fixed; this one is open and worse.

**C2 — The production database is an evictable cache with lost-update semantics.** See §2.2. Money-losing by construction.

**C3 — "Coinbase CDP" custody does not exist.**
`CdpVaultProvider` (`packages/custody/src/index.ts:91-120`) takes the same `lookup` and `sign` closures as `DevLocalProvider`, reads the plaintext private key from SQLite, and signs locally with viem. The *only* effect of setting `CDP_API_KEY_ID`/`CDP_API_KEY_SECRET` is that `name` flips to `"cdp"`. There is no `@coinbase/cdp-sdk`, no `@coinbase/coinbase-sdk`, no Coinbase HTTP call anywhere in the monorepo. The product then reports this to users as fact: `GET /v1/guardian/setup` returns `custody: "cdp"`, `cdpWired: true`, and `settlement: "onchain (cdp) · base"` (`index.ts:1518-1537`), and the public landing page states **"Coinbase CDP — holds the keys for you"** (`page.tsx:90-92`) and lists CDP and **ERC-4337** (entirely absent from the codebase) under "Built with". A customer would reasonably conclude their keys are in Coinbase's MPC custody. They are in a hot EOA in a base64 blob.

**C4 — Vault private keys stored in plaintext.**
`store.createOrg` generates an EVM keypair and writes the raw private key to `vaults.private_key` (`store.ts:1176-1182`). API keys got the A13 hashing treatment; the actual money-controlling secrets did not. No encryption at rest, no KMS envelope, no HSM. On Vercel these keys are base64-encoded into a shared cache entry on every request.

**C5 — "Rotate vault key" irrecoverably destroys funds.**
`store.rotateVaultKey` (`store.ts:2085`) generates a new keypair and `UPDATE vaults SET private_key = ?` — overwriting the old key with no export, no sweep of on-chain balance to the new address, and no check that the balance is zero. The route confirms it: *"Old key is discarded from the store"* (`treasury-routes.ts:1006`). One click in the Recovery tab permanently loses every USDC and ETH held at the old address.

**C6 — Real on-chain transfers can execute without being recorded.**
`transferUsdcFromVault` awaits `waitForTransactionReceipt({ timeout: 120_000 })` (`chain/transfer.ts:133`). The Vercel route sets `maxDuration = 60` (`route.ts:8`). A confirmation slower than 60s kills the function mid-await. Because the database is only persisted *after* the response (`route.ts:133-134`), **all** of that request's writes are discarded — including the hold. Net result: real USDC leaves the vault on-chain and the ledger contains no record of it at all. Every subsequent balance, report, and reconciliation is silently wrong.

**C7 — No authentication system.**
There are no users. No email, no password, no OAuth, no SSO, no MFA, no server-side session, no CSRF consideration, no account recovery. "Log in" = paste a bearer key, or click a button that creates an organization with **no authentication whatsoever** and hands back root credentials (`login-view.tsx:151-184`). The founder guardian key is stored in `localStorage` (`console/page.tsx:247, 312`), never expires, and cannot be rotated. Any XSS — including one introduced by a future dependency — is instant, permanent, total org compromise. `README.md:264` lists "guardian login (Auth.js)" under *Next*; the product is live without it.

## HIGH

**H1 — Per-agent programmable budgets are not enforced by policy.** `rulesFor(agentId, orgId)` reads exactly one template: `store.getPolicyTemplate(orgId)` (`engine.ts:49`). Per-tx max, daily max, allowlists, quiet hours, HITL threshold and velocity are **org-wide**. The only per-agent controls are the ledger stipend and the freeze flag. The marketing promise ("Each agent gets its own wallet and budget… rules the AI cannot talk its way around") and the vision statement ("assign programmable budgets") are both unmet at the enforcement layer. This is the single largest *product* gap.

**H2 — No org-level aggregate spending cap.** `dailyMaxMicro` is applied against `spentLast24h(agentId)` — per agent. Twenty agents under a "$50 daily max" can spend $1,000/day. There is no org-level ceiling anywhere. For a treasury product this is a serious control gap.

**H3 — Treasury "Deposit" mints unbacked money.** `POST /v1/guardian/treasury/deposit` credits `org:available` by any amount from the `external` contra account with no on-chain event (`treasury-routes.ts:582-597`). "Withdraw" is the mirror image and **broadcasts nothing**. The UI does label this honestly ("Demo books only — does NOT broadcast on-chain") but the success toast then says *"Sent 10 USDC from the vault."* Phantom balance flows straight into allocations, Insights, P&L, burn forecast, and invoices with no marker distinguishing it from real funds.

**H4 — The ledger is never reconciled against the chain.** `reconcileOrgUncached` replays journals against account balances (`store.ts:3299`). It proves the books agree with themselves. It never compares `org:available` to the vault's actual on-chain USDC balance. Combined with H3 and the mock rail, the ledger can be arbitrarily divergent from reality and reconciliation still reports `ok: true`. "Complete auditability" currently means "internally consistent", which is not what a CFO means by it.

**H5 — The mock rail books fabricated payments as real.** Any `pay` to a non-`0x`, non-URL destination silently routes to `TransferMockRail`, which returns `settled: true` with `txHash: "0xmock_…"` (`rails/transfer-mock.ts`). The ledger, decisions, vendor analytics, P&L, and webhooks treat it identically to a settled on-chain payment. The rail name is in the response payload but is not persisted on the decision row, so historical activity cannot be filtered to "money that actually moved."

**H6 — No nonce management for concurrent on-chain transfers.** `EvmUsdcTransferRail` creates a fresh viem wallet client per call (`chain/transfer.ts:62-68`) and lets viem fetch the nonce. Two agents in the same org paying concurrently — permitted up to `maxPaysPerMinute: 10` — will fetch the same nonce and one transaction will replace the other. One agent's payment silently disappears while the ledger records both.

**H7 — No gas management.** Each org vault is a bare EOA that must hold native ETH. There is no gas top-up, sponsorship, paymaster, or ERC-4337 account abstraction (despite ERC-4337 appearing in the landing page's "Built with" strip). The failure surfaces as `INSUFFICIENT_GAS` mid-mission with a message telling the user to go fund an address manually. For an autonomous-agent product this breaks the core promise: agents cannot operate unattended.

**H8 — Rate limiting is keyed on attacker-controlled input.** `const key = req.header("authorization") ?? req.ip` (`index.ts:232`). Rotating the `Authorization` header on each request yields a fresh 5,000/min bucket. The limiter stops honest retry storms and nothing else. It is also an unbounded in-memory `Map` keyed on attacker input — a memory-exhaustion vector.

**H9 — README documents a security regression suite that does not exist.** `README.md:124-146` describes `security.mjs` proving idempotency-before-execution, approval re-evaluation, atomic claims, allowlist voting, x402 validation, and quorum identity counting. `git log --all -- "*security.mjs"` returns nothing — it has never existed in any branch. The *behaviours* are real and I verified them in source; the *evidence* is fabricated. In a diligence pack, a claimed-but-absent test suite is worse than no claim.

## MEDIUM

**M1 — Webhook delivery is unreliable in production.** Retries are scheduled with `setTimeout` after the response is sent (`webhooks.ts`, `RETRY_DELAYS_MS`). Serverless functions freeze after responding, so retries never fire; and delivery-status writes land after `persistDbToCache` has already run, so they are discarded.

**M2 — x402 is a closed loop that has never settled on-chain.** Buyer (`rails/x402.ts`), seller and facilitator (`apps/x402-seller`) are all ABI code. The facilitator "verifies signatures cryptographically and fakes onchain settlement" with `randomBytes` as the tx hash. No `x402`/`x402-fetch`/`x402-express` package, no CDP facilitator. See §7.4 for the signature bug that would block real settlement today.

**M3 — Compliance screening is an environment variable.** The default `EnvDenylistScreener` reads `ABI_COMPLIANCE_DENYLIST` (`platform/compliance.ts:41`). No OFAC list, no sanctions data, no KYT, no Chainalysis/TRM adapter. The seam is well-designed; nothing is behind it. Blocking for any regulated customer.

**M4 — Org financial data is sent to OpenAI with no tenant control.** `runLlmToolLoop` posts a system prompt containing balances, agent names, spend figures and remembered facts to `api.openai.com` using a **platform-level** `OPENAI_API_KEY` (`abi-agent/llm-loop.ts:228-285`), enabled by default (`ABI_CHAT_AGENT !== "0"`). No per-tenant opt-out, no DPA surface, no data-residency control, no disclosure in the UI. An enterprise security questionnaire fails on this line alone.

**M5 — Empty session-key scopes fail *open*.** `if (!scopes.length) scopes = ["read", "pay", "escrow"]` (`store.ts:1298-1301`). A session key created with an empty scope array silently receives full money authority. Scope failures must fail closed.

**M6 — SSRF surface via the `api_seller` policy template.** `templateApiSeller()` ships `domainAllowlist: ["localhost"]` (`packages/policy/src/index.ts:456`) and `bootstrapDemo` adds `localhost` to the demo org (`store.ts:3456`). An agent can then make the server fetch arbitrary `http://localhost:*/…` URLs via `pay_api`. `redirect: "error"` mitigates redirect-based pivots; the direct fetch is not gated by the `webhookUrlProblem` IP denylist that protects webhooks. The same guard should protect the x402 rail.

**M7 — `newCounterpartyCooldownHours` is not a cooldown.** It is treated as a boolean: any nonzero value forces `review` for unknown destinations regardless of hours, and the code comments admit it (`packages/policy/src/index.ts:269-275`). The UI presents it as an hours field. Misleading control.

**M8 — Quiet hours are UTC-only.** `inQuietHours` reads `getUTCHours()` (`:95`). No org timezone. An Asia-Pacific customer setting "22:00–06:00" gets a window in the middle of their working day.

**M9 — Approvals have no step-up authentication and no verifiable identity.** `resolvedBy` is a free-text string with a default of `"guardian"` (`index.ts:1556`). Whoever holds the bearer key approves any payment; the audit trail records whatever label the client sent. Quorum correctly counts authenticated `guardianId`s, but with no user identity system there is nothing behind those IDs.

**M10 — `PolicyTemplate` version bumping is unclear on restore.** `restorePolicyVersion` calls `setPolicyTemplate` with `restore:<v>` as the note; combined with `getPolicyVersion`, decision rows may attribute a decision to a version string that no longer describes the active rules. Auditability risk, low blast radius.

## LOW

- **L1** — `/v1/guardian/orgs` returns a root credential and is enabled in production via `POLICYVAULT_ALLOW_PUBLIC_ORG_CREATE=1` (documented in `.env.example:17`). Unlimited anonymous org creation = unbounded resource growth in a shared blob.
- **L2** — Default key pepper is a hardcoded literal (`"abi-vercel-demo-pepper"`, `route.ts:85`; `"abi-dev-pepper-change-me"`, `secrets.ts:10`). Keys are high-entropy so this is not directly exploitable, but a public constant should never be a production default.
- **L3** — `secretMatches` falls back to plaintext comparison for un-prefixed stored values (`secrets.ts:31`). Intentional for one-shot migration; should be removed once migration is proven.
- **L4** — `escrow_lock` records `recordPay(agentId, authorizedMicro)` at lock time, so a locked-then-refunded escrow permanently consumes daily-cap headroom (`engine.ts:188`). Refunds never restore the cap.
- **L5** — 47 `<button>` elements without an explicit `type` inside forms — implicit `type="submit"` causes accidental submissions.
- **L6** — `apps/api/scripts/stress-probe.mjs` is referenced by the UX audit doc but has no npm script binding it.
- **L7** — `X402Error` union does not include `INSUFFICIENT_ONCHAIN_USDC` / `INSUFFICIENT_GAS`; the EVM rail smuggles them through a duck-typed `code` property on a plain `Error` (`rails/evm-usdc-transfer.ts:33-38`). Works, but the type system no longer describes the contract.

---

# 4. USER JOURNEY REVIEW (Step 5)

I walked every transition. Rating: ✅ solid · ⚠️ friction · ❌ broken or trust-losing.

| # | Transition | Rating | Finding |
|---|---|---|---|
| 1 | Landing → understand the product | ✅ | Clear, well-written, "Let AI agents pay for things — without losing control" is an excellent line. Undermined by unsupportable CDP/ERC-4337 claims. |
| 2 | Landing → Console | ⚠️ | A **4.2-second** blocking vault animation before the login card is interactive (`login-view.tsx:12`). Skippable and reduced-motion aware — but it gates the primary action on a cinematic. Enterprise buyers read this as unserious. |
| 3 | Authentication | ❌ | No account. Paste a key, or click a button that mints root credentials with zero identity. There is no "log in" in the sense any buyer means. |
| 4 | Organization creation | ⚠️ | Works, and the key-reveal card with copy/download/acknowledge is genuinely well-designed. But: no email, no verification, no recovery path. Lose the key → lose the org and its funds, forever. |
| 5 | Wallet connection | ❌ **Missing entirely** | There is no wallet connection. No WalletConnect, no RainbowKit, no Privy, no Coinbase Wallet SDK, no "connect wallet" anywhere. ABI generates a custodial EOA you cannot see, export, or control. The vision step "connect a wallet" does not exist as a concept in this product. |
| 6 | Funding | ⚠️ | Two contradictory paths: (a) send real USDC to the vault address → auto-credit (real, works, good UX with polling); (b) "Manual ledger receive" → mints unbacked money. Both live on the same screen. New users will use (b) and believe they funded something. |
| 7 | Treasury | ⚠️ | Rich: multi-asset, cashflow, forecast, moves, recovery. But the "Recovery" tab contains a one-click button that destroys funds (C5). |
| 8 | Create agent | ✅ | Best flow in the product. Create → key shown once → profile → groups → session keys → freeze/archive/rotate. |
| 9 | Assign budget | ⚠️ | Ledger allocation works and is well-modelled. But "budget" implies rules; there are none per agent (H1). |
| 10 | Configure policies | ✅ | Excellent. Band validation, templates, versions with restore, and a replay simulator that tells you *"5 of 13 past decisions would change"*. This is a differentiated feature and it works. |
| 11 | Run mission | ✅ | The Playground is the strongest demo asset in the repo. Real API calls, real policy engine, survives navigation, live indicator, plain-English step summaries with raw JSON behind a toggle. |
| 12 | Payment request → approval | ✅ | The parked-payment → alert → auto-jump → approve → agent resumes loop is genuinely impressive and is the product's best story. |
| 13 | Transaction | ⚠️ | Real for `0x` destinations with a funded, gassed vault. Mock for everything else, indistinguishably in the books (H5). |
| 14 | Audit | ⚠️ | Decisions, journals, votes, freezes, policy versions, CSV export — all present and good. Not reconcilable to chain (H4). |
| 15 | Reports | ✅ | Insights (P&L, vendors, forecast, anomalies) are well-conceived. The forecast refusing to extrapolate from a short window is a class act. |

**Where a real user abandons:** step 3 (no account) if they are an enterprise buyer; step 5 (no wallet connection) if they are crypto-native; step 6 (which deposit is real?) if they are careful; step 13 (`INSUFFICIENT_GAS`, go fund an EOA manually) if they got that far.

**Where trust is lost, specifically:** the moment a technical evaluator opens `packages/custody/src/index.ts` and sees that the CDP provider is the dev provider with a renamed field, while the Settings screen they were just looking at said `custody: cdp`. Everything else in the audit becomes suspect from that point.

---

# 5. MISSING FEATURES

Required by the stated vision, absent from the codebase:

**Identity & access**
1. Any authentication system (users, email, password, OAuth/SSO, SAML/SCIM)
2. MFA — especially step-up MFA on approvals above a threshold
3. Server-side sessions with expiry; key rotation for the founder guardian key
4. Account recovery / break-glass
5. Real RBAC beyond `owner`/`approver`/`viewer`; no custom roles, no scoped permissions
6. Audit attribution to a verified human identity

**Money & custody**
7. Actual Coinbase CDP (Server Wallets / MPC) integration
8. Key encryption at rest (KMS envelope) as an interim measure
9. Wallet connection for user-controlled funds
10. Gas abstraction — paymaster, sponsorship, or ERC-4337 (currently claimed, not built)
11. Nonce management / transaction queue per vault
12. On-chain ↔ ledger reconciliation with attestation
13. Multi-sig or threshold approval on the custody layer itself
14. Withdrawal that actually broadcasts
15. Multi-chain beyond Base; non-USDC settlement assets

**Policy**
16. **Per-agent policy overrides** — the headline capability
17. Org-level aggregate spend caps (daily/weekly/monthly)
18. Spend categories / MCC-style classification
19. Counterparty risk scoring beyond binary allowlist
20. Timezone-aware quiet hours
21. Time-boxed and purpose-boxed budgets (campaign budgets, expiry)

**Compliance**
22. OFAC/sanctions screening with a real data source
23. KYT / transaction monitoring
24. KYB onboarding for organizations
25. Travel Rule handling
26. Data retention and deletion policies (GDPR)
27. Any compliance certification path (SOC 2 evidence collection, audit logging standards)

**Platform**
28. Published SDK — `@policyvault/*` are private workspace packages; integrating requires cloning the monorepo
29. **Python SDK** — the AI-agent ecosystem (LangChain, CrewAI, AutoGen, OpenAI Agents SDK) is majority Python. Its absence is a GTM blocker, not a nice-to-have
30. Framework adapters (LangChain tool, CrewAI tool, OpenAI function schema, Vercel AI SDK)
31. Self-service API key management outside the console
32. Billing, metering, subscription infrastructure (pricing page is Free/Contact/Contact)
33. Push notifications for mobile approvals
34. Status page, SLA, incident tooling
35. Test/lint/typecheck CI

---

# 6. PRODUCT RISKS

**R1 — Credibility risk (highest).** The delta between claim and implementation on CDP, ERC-4337, and the `security.mjs` suite is not a bug — it is a pattern. A YC partner or an acquirer's technical diligence will find it in under an hour, and it will reframe every other claim as unverified. Fix this before *any* external technical review, and fix it by changing the claims first (fast, free) and the code second.

**R2 — The moat is thin and the incumbents are adjacent.** The defensible asset is the policy engine + HITL + ledger semantics, and it is ~1,400 lines. Coinbase (CDP Server Wallets + x402 + Spend Permissions), Privy, Turnkey, Crossmint, and Skyfire are all building toward this. ABI's genuine differentiator — the *replay simulator* and the *approval-with-re-evaluation* semantics — is under-marketed relative to "AI agent wallet", which is the crowded framing.

**R3 — Wrong-layer risk.** ABI has built custody + ledger + policy + console. Custody and ledger are the parts with the highest regulatory burden, the highest engineering cost, and the lowest differentiation. A version of this product that is *policy + approvals + audit* on top of someone else's custody (CDP, Privy, Turnkey) ships faster, passes security review, and is more defensible. I would seriously stress-test whether owning custody is a strategy or an accident.

**R4 — Regulatory exposure.** Custodying customer USDC in the US is money transmission. The `LEGAL_FOOTER` disclaimer is a good instinct and legally insufficient. No KYB, no sanctions screening, no Travel Rule. This must be resolved before touching mainnet with third-party funds.

**R5 — Single-author, agent-generated codebase.** 116 of 108 commits are attributed to "Cursor Agent". The code quality is high in places and the comments are unusually good, but there is no evidence of independent human review of the money path. Combined with zero CI, there is no mechanism preventing a regression in `engine.ts` from reaching production.

**R6 — Naming.** "Artificial Banking Incorporated" invites banking-regulator attention for a product that is explicitly not a bank, and the codebase still says PolicyVault. Pick one name; if the product is not a bank, consider not naming it one.

**R7 — Token distraction.** `contracts/AbincToken.sol` (fixed-supply ERC-20 for Base) plus `docs/LAUNCH.md` references to pump.fun sit next to an unfinished financial product. Correctly firewalled in code ("not wired into the console or agent USDC vaults") but its presence in the repo during a fundraise is a signal risk.

---

# 7. SECURITY REVIEW (Step 7)

## 7.1 Ranked attack surface

| # | Vector | Sev | Exploitability | Impact |
|---|---|---|---|---|
| 1 | Anonymous `POST /v1/demo/bootstrap` | **Critical** | Trivial — one curl, no auth | Total, permanent, multi-tenant data + key destruction |
| 2 | Runtime Cache lost updates | **Critical** | Passive — happens on its own | Silent fund/ledger loss |
| 3 | Plaintext vault keys in a shared cache blob | **Critical** | Requires cache/infra access | Total fund theft across all tenants |
| 4 | Guardian key in `localStorage`, no expiry | **Critical** | Any XSS | Permanent full org compromise |
| 5 | `rotate-vault` destroys keys | **Critical** | One authenticated click | Irrecoverable fund loss |
| 6 | 60s function limit vs 120s receipt wait | **High** | Passive under load | Unrecorded on-chain outflow |
| 7 | Anonymous org creation | High | Trivial | Resource exhaustion in a shared blob |
| 8 | Rate limit keyed on `Authorization` | High | Trivial header rotation | Bypass + unbounded memory growth |
| 9 | Empty session scopes → full scopes | Medium | Requires a misconfigured key | Privilege escalation |
| 10 | SSRF via `localhost` in the seller template | Medium | Requires agent key + that template | Internal network probing |
| 11 | Org data → OpenAI, no tenant control | Medium | Passive | Data-governance / DPA failure |

## 7.2 What is genuinely well-defended

Credit where due — this list is longer than most products at this stage:

- Guardian org is **always** derived from the bearer key, never from request params or body. No IDOR on org scope anywhere I could find.
- Tenant checks (`agent.orgId !== org.id`) are applied consistently at every call site I audited (~30 of them). Fragile pattern, correct execution.
- `ownerOnly` gating on mutating routes; viewers are read-only enforced at the middleware layer.
- Cross-tenant guard inside `applyJournal` itself — defence in depth at the ledger.
- Webhook HMAC-SHA256 over the raw body, secret shown once, rotation endpoint, delivery dedupe ID, plus a real SSRF denylist (`webhook-url.ts`) covering IPv6, CGNAT, cloud metadata, and embedded credentials — re-checked at delivery time, `redirect: "error"`.
- x402 seller-field validation before signing (asset pinned per network, `payTo` format + blocklist, price sanity, validity window clamped to 120s).
- Quorum counts authenticated identities, so one guardian cannot self-satisfy 2-of-N.
- Approval re-evaluation at execution time — the correct and uncommon choice.
- The LLM is genuinely sandboxed: read-only tools only; external actions are HITL proposals that execute nothing (`abi-agent/llm-loop.ts`, `external-actions.ts`). The "LLM proposes, policy authorizes, keys never enter the model" claim **is true**, and it is the security claim that matters most for this product category.

## 7.3 Prioritised security remediation

**Now (before the deployment is reachable by anyone):**
1. Delete `/v1/demo/bootstrap` or require the guardian key + an explicit env flag; remove the `ensureEmbedEnv` override.
2. Take the public deployment down, or move it behind Vercel Deployment Protection, until 1–5 land. (The one CI workflow currently *disables* that protection.)
3. Encrypt vault keys at rest with a KMS envelope, or remove self-custody entirely in favour of a real provider.
4. Make `rotate-vault` refuse when on-chain balance > 0; require an explicit sweep-to-new-address first.
5. Remove the CDP/ERC-4337 claims from the landing page and the `setup` endpoint until they are true.

**Before beta:**
6. Real auth: Auth.js or WorkOS; users, orgs, memberships, server-side sessions, MFA. Bearer keys become machine credentials only.
7. Move the guardian credential out of `localStorage` into an httpOnly cookie session.
8. Step-up MFA on approvals above a configurable threshold.
9. Rate-limit on `(hashed key ∨ IP)` with a bounded store; per-route budgets on expensive endpoints.
10. Session scopes fail closed.
11. Per-tenant control over LLM data egress; document it; make it opt-in.
12. Apply the `webhookUrlProblem` guard to the x402 fetch path; drop `localhost` from shipped templates.

**Before public launch:**
13. Real sanctions/KYT screening behind the existing `ComplianceScreener` seam.
14. Third-party penetration test and a smart-contract/rail review.
15. SOC 2 Type I evidence collection; secrets management; key custody policy.

## 7.4 Two concrete bugs that would block real settlement

**(a) EIP-712 domain is wrong for Base Sepolia.** `eip712Domain` hardcodes `name: "USD Coin", version: "2"` for both networks (`rails/x402.ts:69-76`). Base Sepolia's USDC (`0x036CbD…`) uses `name: "USDC"`. The dev facilitator hardcodes the *same* wrong domain (`x402-seller/src/index.ts:100-105`), so the loop verifies against itself and passes. Against a real facilitator or the actual token contract, `transferWithAuthorization` would fail signature recovery. This is strong evidence the x402 rail has never been settled on a real network, notwithstanding the docs.

**(b) `pay` with an `0x` destination bypasses x402 entirely** and takes the direct ERC-20 rail (`engine.ts:320-330`). Correct by design, but it means the "agent pays your wallet" E2E proof in `docs/E2E-ONCHAIN-AGENT-PAY.md` demonstrates the **transfer rail**, not the **x402 rail**. The x402 claim remains unproven on-chain.

---

# 8. PRODUCT COMPLETENESS (Step 8)

> **Can an autonomous AI agent reliably and safely execute a real crypto payment through the intended Coinbase CDP and x402 workflow?**

**No.** Broken into its three parts:

| Claim | Verdict |
|---|---|
| Real crypto payment | ⚠️ **Yes, narrowly.** `POST /v1/agent/pay` to an allowlisted `0x` on Base/Base Sepolia performs a genuine ERC-20 `transfer` from the vault EOA with a verifiable Basescan hash — provided the vault holds USDC *and* ETH, and confirmation lands within 60s. |
| via Coinbase CDP | ❌ **No.** Zero CDP code exists. |
| via x402 | ❌ **No.** Self-contained demo loop with a signature domain that would fail against the real contract. |
| **reliably** | ❌ **No.** Lost writes (C2), unrecorded outflow on timeout (C6), nonce collisions (H6), no gas management (H7), no retry/queue. |
| **safely** | ❌ **No.** Plaintext keys (C4), anonymous wipe (C1), no auth (C7). |

### Blockers, ranked

| # | Blocker | Sev | Blocks |
|---|---|---|---|
| 1 | Persistence is an evictable cache with lost updates | Critical | Everything |
| 2 | Anonymous destructive endpoint | Critical | Any real deployment |
| 3 | No CDP integration | Critical | The stated architecture + the pitch |
| 4 | Plaintext hot keys, no encryption/HSM/MPC | Critical | Real funds, any security review |
| 5 | No authentication system | Critical | Any customer |
| 6 | Vault rotation destroys funds | Critical | Safe operation |
| 7 | 60s limit vs 120s receipt wait | High | Ledger correctness on mainnet |
| 8 | x402 signature domain wrong for Sepolia | High | Real x402 settlement |
| 9 | No per-agent policy | High | The core "programmable budgets" promise |
| 10 | No gas abstraction | High | Unattended autonomy |
| 11 | No nonce management | High | Multi-agent concurrency |
| 12 | Background sweeps dead in prod (subscriptions never charge) | High | Recurring payments, escrow timeouts, Telegram |
| 13 | No on-chain reconciliation | High | Auditability claim |
| 14 | Fake deposit mints unbacked balance | High | Trust, correct accounting |
| 15 | No compliance screening | High | Any regulated customer |
| 16 | No CI, critical paths untested | Medium | Safe iteration |
| 17 | No published/Python SDK | Medium | Developer adoption |
| 18 | Brand incoherence (PolicyVault ⇄ ABI) | Medium | Integration, positioning |

---

# 9. UX REVIEW (Step 9)

**This is the dimension where ABI is genuinely strong**, and it is being undersold by everything around it.

### What works
- **Visual system.** Consistent glass/steel language, disciplined type scale, coherent accent usage across ~11.9k lines of view code. It reads as designed, not assembled.
- **Information architecture.** Money / Agents / Records / Config is the right first cut. Collapsible folders, alias views that deep-link into parent surfaces with the right tab, URL state via `?view=&tab=` — thoughtful.
- **The approval loop.** New approval → alert → optional auto-jump → decide → agent resumes. The refinement of *not* yanking you off the Playground (because approve/deny is already inline there) is the kind of detail that only comes from actually using the product.
- **The Playground.** Missions survive navigation, show a live indicator, report plain English with raw JSON behind a toggle, archive a deliverable. Best demo asset in the repo.
- **Honest empty and refusal states.** Insights declining to forecast from too short a window, rather than printing an impressive fabrication, is the single most trust-building decision in the product.
- **Craft details.** Command palette, keyboard shortcuts with a help overlay, page tours, skeletons, toasts, connection indicator, `prefers-reduced-motion` handling in 11 places, polling that pauses on hidden tabs and fingerprints results to avoid needless re-renders.

### What hurts
1. **The 4.2s vault intro gates the primary action.** Skippable, but the first impression for an enterprise buyer is a cinematic, not a product.
2. **Onboarding is "paste a bearer token."** No password manager integration, no SSO, no team invite by email. This is a developer tool wearing enterprise clothes.
3. **Two contradictory funding paths on one screen** (H3). The label is honest; the success toast is not.
4. **The nav has grown to 16 views across 10 rail entries with alias routing.** Coherent today; it is one feature away from needing a real IA revision.
5. **Everything is client-rendered.** 320 kB first load; the console is blank until JS hydrates and the first poll returns.
6. **Accessibility is partial.** 81 `aria-*` and 13 `role=` attributes across 17k lines is thin. 47 untyped `<button>`s. No skip-link, no focus-trap audit on dialogs, no visible-focus audit. No stated WCAG target.
7. **431 inline `style={{}}` objects** alongside Tailwind and a 7k-line CSS file — three styling systems competing. This will not survive a design-system pass.
8. **Mobile is a stub.** A separate `/approvals` PWA-ish page exists and the Expo app is orphaned with no push. Approvals expire in 10 minutes; without push, mobile approval is not a workflow.

### Would this impress?

| Audience | Verdict |
|---|---|
| **Developers** | **Mixed.** They will admire the policy engine and approval semantics, and stop cold at "no npm package, no Python SDK, clone the monorepo." |
| **YC partners** | **Interested, then concerned.** The demo is strong and the insight ("agents need spending controls, not wallets") is real. Then a technical partner opens the custody file. The CDP discrepancy is the meeting-ender — not because it's fatal to build, but because it raises the "what else is claimed?" question. |
| **Enterprise customers** | **No.** Security review terminates at: no SSO, no MFA, no audit-log standards, no SOC 2 path, no DPA, keys in a browser, an unauthenticated wipe endpoint. |
| **AI startups (the real ICP)** | **Closest to yes.** They care about the policy engine, the approval loop, and MCP support — all real. They will still need a Python SDK and a working CDP or Privy custody story. |

---

# 10. FINAL RECOMMENDATION

## The single most important decision

**Stop owning custody.** ABI's differentiation is the policy engine, the approval semantics, and the audit trail. Custody is the highest-regulation, highest-risk, lowest-differentiation part of the stack, and the current implementation is a hot EOA in a cache blob. Integrating real CDP Server Wallets (or Privy/Turnkey) deletes findings C3, C4, C5, and most of H6/H7 in one move, makes the marketing claim true, and lets the team spend its remaining time on the part nobody else is building well.

The second decision: **revert the embedded-API deployment.** Run `apps/api` as a real long-lived process (the `Dockerfile` and `docker-compose.yml` already exist) against Postgres behind the `store.ts` seam that was built for exactly this. That deletes C2, C6, M1, and restores every background sweep. Vercel keeps the marketing site and console.

Neither is a rewrite. The domain core — the good part — is untouched by both.

## Prioritised plan

### Immediate — this week, before anything is shown to anyone

1. Take the public deployment offline or put it behind Deployment Protection.
2. Remove or authenticate `/v1/demo/bootstrap`; delete the `ensureEmbedEnv` bootstrap override.
3. Strip the CDP, ERC-4337 and `security.mjs` claims from `page.tsx`, `README.md`, and the `/v1/guardian/setup` response. Replace with what is true. **This is the highest-ROI hour of work in the entire plan.**
4. Make `rotate-vault` refuse with a non-zero on-chain balance.
5. Add a CI workflow: install → build → test → typecheck on every PR. Delete the SSO-disabling workflow.
6. Fix the root `test` script so it runs cross-platform; add the web workspace to it.
7. Pick a name. Rename `@policyvault/*`, `pv_*` key prefixes, `x-policyvault-*` headers, and the DB file. Do it now while there are no integrators.

### Before Beta — 4–8 weeks

8. Deploy `apps/api` as a persistent service with Postgres (wire `packages/db` behind `store.ts`). Restore all background sweeps.
9. Real authentication: users, orgs, memberships, server-side sessions, MFA, invitations by email. Bearer keys become machine-only credentials.
10. Real custody via CDP Server Wallets behind the existing `CustodyProvider` interface. If CDP slips, use Privy or Turnkey — the seam does not care.
11. **Per-agent policy overrides** with org-level defaults, plus an org-level aggregate daily cap (H1, H2).
12. Delete the fake deposit/withdraw, or move them behind an explicit "demo mode" that taints every derived number in the UI (H3).
13. On-chain ↔ ledger reconciliation, surfaced in the console with a drift alert (H4).
14. Persist the settling rail on the decision row; render "real" vs "simulated" everywhere money is shown (H5).
15. Nonce management / per-vault transaction queue; gas balance monitoring with alerts (H6, H7).
16. Fix the x402 EIP-712 domain per network and prove one settlement against a real facilitator on Base Sepolia (§7.4). Publish the tx hash.
17. Tests for the money path: `executeIntent`, `resolveApproval` + quorum, idempotency replay, escrow CAS, RBAC, webhook signing. Target: the security claims in the README are backed by an actual suite.

### Before Public Launch — 2–4 months

18. Publish `@abi/sdk` to npm **and** ship a Python SDK. Add LangChain / CrewAI / OpenAI-Agents adapters. This is the adoption unlock.
19. Real sanctions + KYT screening behind `ComplianceScreener`; KYB onboarding.
20. SSO/SAML, SCIM, custom roles, tamper-evident audit log, data-retention controls.
21. Third-party penetration test; SOC 2 Type I evidence collection.
22. Push notifications; ship the mobile approvals app properly or delete `apps/mobile`.
23. Billing and metering.
24. Accessibility pass to a stated WCAG 2.1 AA target; consolidate the three styling systems.
25. Status page, SLAs, incident runbooks.

### Post Launch
26. Multi-chain and multi-asset settlement.
27. Spend categories, counterparty risk scoring, timezone-aware quiet hours, time-boxed budgets.
28. Agent-to-agent commerce (the escrow primitive is already built and is under-exploited).
29. Anomaly detection with learned baselines rather than heuristics.
30. Marketplace of policy templates by vertical.

### Future Roadmap
31. Agent credit / underwriting from spend history — the natural extension of owning the ledger.
32. Cross-org agent settlement network.
33. Programmable revenue share for agents that earn.
34. Insurance / bonding against agent misbehaviour.
35. Regulatory licensing (MTL or a partner bank) if custody stays in-house.

---

## Closing judgment

**Is this capable of becoming the financial operating system for autonomous AI agents?**

The *thesis* is right, the *timing* is right, and — critically — **the hardest technical problem is already solved correctly.** Deterministic policy evaluation, human-in-the-loop with re-evaluation at execution time, double-entry with replay reconciliation, idempotency reserved before execution: that is the durable core, it is well-built, and most teams attempting this space get it wrong.

What surrounds it is a demo that has been described as a product. Every one of the Critical findings is infrastructure that can be replaced without touching the good part — different persistence, different custody provider, a real auth layer. That is weeks of work, not a rewrite. The codebase is closer to viable than the score suggests.

The thing that is *not* fixable with engineering time is the claim gap. "Coinbase CDP holds the keys for you" on a public site while `CdpVaultProvider` reads a plaintext key out of SQLite; a README security section citing a test suite that has never existed. These cost nothing to fix and everything to leave in place. **Fix the claims this week, then fix the infrastructure.** In that order — because the second is worth much less if the first has already cost you the reader's trust.

**Recommendation: do not show this to YC, an enterprise prospect, or a security reviewer in its current state.** Execute the Immediate list — it is roughly one focused week — and the same repository presents as an early-but-serious infrastructure company with an unusually well-reasoned core. Today it presents as something that overstates itself, and that is a much harder impression to undo than a missing feature.
