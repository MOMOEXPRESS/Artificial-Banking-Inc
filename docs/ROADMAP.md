# ABI — Master Implementation Roadmap

**Derived from:** `ABI-AUDIT-2026-07-26.md`
**Baseline commit:** `5f7138c` (`main`)
**Status:** Planning only. No code written. Awaiting approval before Phase 0.
**Execution model:** one phase at a time, each ending in a single clean commit and a stop for approval.

---

# 1. EXECUTIVE SUMMARY

## The strategy in one paragraph

ABI's domain core — the policy engine, the double-entry ledger, and the approval semantics in `engine.ts` — is correct and should not be rewritten. Everything around it is either untrue, unsafe, or unable to survive concurrency. The roadmap therefore does **not** start with features. It starts by making the product's claims true (Phase 0), removing the ways it can currently be destroyed or lose money (Phase 1), and replacing the runtime that invalidates every guarantee the core provides (Phase 2). Only once the foundation holds do we add identity, real custody, correct settlement, and the per-agent programmability that the vision promises. Features that depend on unfinished foundations are deliberately deferred, even where they look cheap.

## Four sequencing principles

1. **Truth before code.** Claims about CDP, ERC-4337, and a non-existent `security.mjs` suite cost nothing to correct and everything to leave in place. This is Phase 0 and it takes hours, not weeks.
2. **Containment before construction.** An anonymous endpoint that wipes all tenants, and a "rotate key" button that destroys funds, must be neutralised before anything is built on top of them. Phase 1.
3. **Foundation before features.** The Runtime Cache persistence model silently discards writes. Every feature built on it inherits that defect and every test written against it is meaningless. Phase 2 is the largest single investment in the roadmap and unblocks eleven downstream findings at once.
4. **Buy the regulated parts.** Custody and gas are the highest-risk, lowest-differentiation surfaces in the stack. Adopting a managed provider (Phase 4) resolves five findings in one move and makes the marketing claim true rather than merely re-worded.

## Consolidations applied

The audit produced 7 Critical, 9 High, 10 Medium, 7 Low findings plus 35 missing features and ~25 UX / engineering / DX recommendations. Many share a root cause. Where they do, they are one task:

| Consolidated task | Absorbs |
|---|---|
| **P2-T1** Persistent API service | C2, C6, M1, background-sweeps-dead, subscriptions-never-charge, Telegram-dead, escrow/approval lazy sweeps, reconciliation watchdog dead |
| **P4-T1** Managed custody provider | C3, C4, C5 (partly), H6, H7 |
| **P7-T1** Backed-balance model | H3, H4, H5 |
| **P6-T1** Scoped policy resolution | H1, H2 |
| **P0-T2** Claim correction | C3 (disclosure half), H9, R1, R6 (partly) |
| **P3-T1** Identity system | C7, L1, M9, plus 6 missing access-control features |

Every finding still appears explicitly, with its ID, in the phase table below. Nothing was dropped for being minor.

## Shape of the effort

| Phase | Theme | Rough size | Gate |
|---|---|---|---|
| 0 | Repository hygiene & truth in claims | Days | — |
| 1 | Blast-radius containment | Days | — |
| 2 | Runtime & persistence foundation | 2–3 weeks | **Everything after this** |
| 3 | Identity & access control | 2–3 weeks | Beta |
| 4 | Custody & key management | 2–3 weeks | Beta |
| 5 | Settlement correctness | 1–2 weeks | Beta |
| 6 | Policy & programmable budgets | 2 weeks | Beta |
| 7 | Treasury integrity & reconciliation | 1–2 weeks | Beta |
| 8 | Agent system & runtime integration | 2 weeks | Beta (partial) |
| 9 | Console, UX & accessibility | 2–3 weeks | Public launch |
| 10 | Developer experience & distribution | 2–3 weeks | Public launch |
| 11 | Compliance & enterprise readiness | 4–8 weeks | Public launch |
| 12 | Launch preparation | 2 weeks | Public launch |
| — | Stretch / post-launch | Ongoing | — |

**Beta gate ≈ end of Phase 8. Public launch gate ≈ end of Phase 12.**

---

# 2. MASTER ROADMAP

Legend — **Complexity:** S(mall) · M(edium) · L(arge) · XL. **Priority:** Critical · High · Medium · Low · Future.

---

## PHASE 0 — Repository Hygiene & Truth in Claims

*Goal: the repository accurately describes itself, and a stranger can build it. No behaviour changes.*

### P0-T1 — Repository cleanup execution
**Description.** Execute the approved cleanup plan (see `ABI-CLEANUP-PLAN.md`): remove dead assets, retire or archive duplicate documentation, delete orphaned workspaces, optimise oversized images.
**Problem.** ~13.9 MB of unoptimised PNGs, two unreferenced assets, 23 overlapping documentation files (35,199 words) including nine competing "state of the project" audits, an orphaned `apps/mobile` outside the workspace list, and an unwired `packages/db` pulling `@prisma/client` into every install.
**Current state.** Repository carries dead weight that slows install/build and makes it unclear which document is authoritative.
**Desired state.** One authoritative doc set; no unreferenced assets; images optimised; workspace list matches the directory tree.
**Reasoning.** Every later phase reads these docs. Cleaning first prevents propagating stale guidance.
**Dependencies.** Approval of the cleanup plan.
**Complexity.** M · **Priority.** High

### P0-T2 — Correct all unsupportable product claims
**Description.** Remove or qualify every claim the code does not support, in the landing page, README, and the `/v1/guardian/setup` API response.
**Problem.** Finding **C3 / H9 / R1**. `page.tsx:90-92` states "Coinbase CDP — holds the keys for you"; the trust strip lists CDP and **ERC-4337** (absent from the codebase); `/v1/guardian/setup` returns `custody: "cdp"`, `cdpWired: true`, `settlement: "onchain (cdp)"` while `CdpVaultProvider` signs with a plaintext key from SQLite; `README.md:124-146` cites a `security.mjs` regression suite that `git log --all` proves has never existed.
**Current state.** A technical evaluator who opens `packages/custody/src/index.ts` discovers the discrepancy and reasonably discounts every other claim.
**Desired state.** Marketing and API surfaces describe self-custody accurately (e.g. "self-custodied vault, CDP integration in progress"); ERC-4337 removed until built; the security section either points at a real test suite or states the guarantees as design intent with file references.
**Reasoning.** Highest return per hour in the entire roadmap. Credibility is the binding constraint on fundraising and enterprise conversations, and it is repairable in an afternoon.
**Dependencies.** None. **Do this first.**
**Complexity.** S · **Priority.** **Critical**

### P0-T3 — Resolve the PolicyVault / ABI brand split
**Description.** Choose one name and apply it to npm scopes, key prefixes, webhook headers, DB filename, `localStorage` keys, log lines, and docs.
**Problem.** `package.json` says `artificial-banking-inc`; `README.md` line 1 says **PolicyVault**; packages are `@policyvault/*`; keys are `pv_guardian_`/`pv_agent_`; webhook headers are `x-policyvault-signature`; the DB is `policyvault.db`; the API logs `PolicyVault API on…`.
**Current state.** An integrator writing a webhook verifier must code against a brand that appears nowhere in the product.
**Desired state.** One name end to end. Key prefixes and header names migrated with a documented compatibility window.
**Reasoning.** There are currently zero external integrators — this is the cheapest it will ever be. After a public SDK ships, header renames become breaking changes.
**Dependencies.** None (but must precede P10-T1, SDK publication).
**Complexity.** M · **Priority.** High

### P0-T4 — Establish CI: build, typecheck, test, lint
**Description.** Add a GitHub Actions workflow running install → build → typecheck → test → lint on every PR and push to `main`. Delete the SSO-disabling workflow.
**Problem.** The only workflow (`.github/workflows/vercel-harden.yml`) exists to **disable Vercel Deployment Protection**. `npm run lint` is `echo "lint: add eslint in later pass"`. No ESLint config exists anywhere.
**Current state.** Nothing prevents a regression in the money path from reaching production. With 116 of 108 commits attributed to an agent and no evidence of independent review, this is the only mechanical safeguard available.
**Desired state.** Red CI blocks merge. ESLint + `@typescript-eslint` configured with rules that matter (`no-floating-promises`, `no-explicit-any`, exhaustive deps). Prettier for formatting.
**Reasoning.** Every subsequent phase modifies money-handling code. CI is the precondition for changing it safely.
**Dependencies.** P0-T5 (test script must run before CI can run it).
**Complexity.** M · **Priority.** **Critical**

### P0-T5 — Fix the test harness
**Description.** Make `npm test` work cross-platform from a clean clone; include the web workspace.
**Problem.** `apps/api/package.json` uses `node --import tsx --test $(find src -name '*.test.ts')` — a POSIX substitution executed through npm's `cmd.exe` on the documented Windows dev platform. Root `npm test` fails from a clean clone (needs a prior build) and hangs indefinitely with zero output after building. `apps/web/src/lib/judgment-bands.test.ts` is in no test script at all.
**Current state.** Verified: all 49 assertions pass when suites are invoked individually; the aggregate command does not work.
**Desired state.** `npm test` runs every suite on Windows, macOS and Linux, from a clean clone, in under 60 seconds. Use Node's glob support or a runner rather than shell substitution.
**Reasoning.** A test suite nobody can run is not a test suite.
**Dependencies.** None.
**Complexity.** S · **Priority.** **Critical**

### P0-T6 — Documentation consolidation and rewrite
**Description.** Collapse nine overlapping status documents into one living architecture doc plus a dated audit archive; rewrite the README to production quality; fix absolute filesystem paths.
**Problem.** 23 markdown files, 35,199 words. `FULL-SYSTEM-REVIEW`, `PILLAR-DEPTH-AUDIT`, `PILLAR-10-REQUIREMENTS`, `UI-AUDIT`, `CONSOLE-UX-AUDIT`, `CONSOLE-CONSISTENCY-AUDIT`, `AUDIT-FINDINGS`, `VALIDATION-BUILD-RUNDOWN`, `FULL-SCALE-BUILD-PLAN` all claim to describe current state and disagree. Six files contain absolute paths to `.` — a location that does not exist for any other developer. `INDEX.md` alone has 11.
**Current state.** No single authoritative document. New contributors cannot tell which is current.
**Desired state.** `README.md` (production quality, per the cleanup plan), `docs/ARCHITECTURE.md` (living), `docs/DEPLOY.md`, `docs/SECURITY.md`, `docs/CONTRIBUTING.md`, `docs/adr/` for decisions, `docs/archive/` for dated point-in-time audits. All paths repo-relative.
**Reasoning.** Documentation is the interface to the codebase for investors, contributors, and future-you.
**Dependencies.** P0-T1, P0-T3.
**Complexity.** M · **Priority.** High

### P0-T7 — Code hygiene sweep
**Description.** Remove commented-out code, unused imports, dead branches; resolve the `@deprecated` marker in `agent-routes.ts:105`; complete or explicitly label placeholder implementations.
**Problem.** Findings **L6, L7** plus general drift. `apps/api/scripts/stress-probe.mjs` is referenced by the UX audit doc but bound to no npm script. `X402Error`'s code union omits `INSUFFICIENT_ONCHAIN_USDC` / `INSUFFICIENT_GAS`; the EVM rail smuggles them through a duck-typed `code` property on a plain `Error` (`rails/evm-usdc-transfer.ts:33-38`), so the type system no longer describes the contract.
**Current state.** Minor but accumulating.
**Desired state.** Lint-clean. Every stub explicitly labelled in code and surfaced in the UI as unimplemented rather than silently no-op.
**Reasoning.** Cheap while the codebase is this size.
**Dependencies.** P0-T4 (lint must exist to enforce).
**Complexity.** S · **Priority.** Medium

---

## PHASE 1 — Blast-Radius Containment

*Goal: nothing anonymous can destroy the platform, and no single click can destroy funds. Days, not weeks.*

### P1-T1 — Remove the anonymous destructive bootstrap endpoint
**Description.** Delete `POST /v1/demo/bootstrap`, or require a guardian key **and** an explicit env flag; remove the `ensureEmbedEnv` override that force-enables it.
**Problem.** Finding **C1 — the single most severe finding in the audit.** The endpoint requires no authentication (`index.ts:671`) and `DELETE`s from 34 tables including `orgs`, `accounts`, `journals`, `agents`, and **`vaults`** (`store.ts:3400-3448`). The team's `ALLOW_BOOTSTRAP` gate is correct, but `ensureEmbedEnv()` sets `POLICYVAULT_ALLOW_BOOTSTRAP = "1"` whenever undefined and runs *before* `await import("@policyvault/api")` evaluates the constant (`route.ts:76-88`), defeating it.
**Current state.** `curl -X POST https://<host>/abi-api/v1/demo/bootstrap` permanently erases every tenant's ledger, audit trail, agent keys, and vault private keys. Funded vaults become unrecoverable.
**Desired state.** Demo data seeding is a scoped, authenticated operation that creates a *new* org and never deletes another tenant's data. Nothing in the deployed application can perform a global wipe.
**Reasoning.** Unauthenticated total data destruction on a live financial product. Nothing else in this roadmap matters if this remains.
**Dependencies.** None. **Highest single priority in the plan.**
**Complexity.** S · **Priority.** **Critical**

### P1-T2 — Gate the public deployment
**Description.** Put the live URL behind Vercel Deployment Protection (or take it offline) until Phase 2 completes. Delete `.github/workflows/vercel-harden.yml`, whose sole function is to disable that protection.
**Problem.** The deployment carries C1, C2, C4, C7 simultaneously and is reachable by anyone. A CI job actively removes the one platform control that would mitigate it.
**Current state.** Publicly reachable, unauthenticated, destructible, with plaintext keys in a shared cache blob.
**Desired state.** Demos are given behind access control or from a local instance until the foundation is safe.
**Reasoning.** Reduces exposure to near zero for the cost of one setting.
**Dependencies.** None.
**Complexity.** S · **Priority.** **Critical**

### P1-T3 — Make vault key rotation non-destructive
**Description.** Refuse rotation while on-chain balance is non-zero; require an explicit sweep-to-new-address first; retain the previous key encrypted until sweep is confirmed.
**Problem.** Finding **C5**. `store.rotateVaultKey` (`store.ts:2085`) generates a new keypair and `UPDATE vaults SET private_key = ?`, overwriting the old key with no export, no sweep, and no balance check. The route confirms: *"Old key is discarded from the store"* (`treasury-routes.ts:1006`).
**Current state.** One click in the Recovery tab permanently loses all USDC and ETH at the old address.
**Desired state.** Rotation is a guided flow: check balance → sweep → confirm on-chain → swap key → archive old key encrypted for a retention window.
**Reasoning.** A single UI click currently causes irreversible fund loss. This is a foot-gun, not a feature.
**Dependencies.** None (hardened again in P4-T1 when custody moves to a provider).
**Complexity.** M · **Priority.** **Critical**

### P1-T4 — Close anonymous org creation and fix rate limiting
**Description.** Require an invite token or authenticated session for org creation. Re-key the rate limiter.
**Problem.** Findings **L1, H8**. `POST /v1/guardian/orgs` returns a root credential and is documented as enabled in production (`.env.example:17`). The rate limiter keys on `req.header("authorization") ?? req.ip` (`index.ts:232`) — attacker-controlled input, so rotating the header yields a fresh 5,000/min bucket. It is also an unbounded in-memory `Map` keyed on that input: a memory-exhaustion vector.
**Current state.** Unlimited anonymous org creation into a shared database blob, with a limiter that stops only honest retry storms.
**Desired state.** Org creation is invite-gated. Limiter keys on `hash(credential) ∨ IP` with a bounded LRU and per-route budgets on expensive endpoints.
**Reasoning.** Cheap to fix, removes two abuse vectors, and prevents unbounded growth of the (currently fragile) datastore.
**Dependencies.** None. Superseded in part by P3-T1.
**Complexity.** S · **Priority.** High

### P1-T5 — Remove default secrets and fail-open paths
**Description.** Refuse to boot in production without an explicit key pepper; make session scopes fail closed; remove the plaintext secret comparison fallback.
**Problem.** Findings **L2, L3, M5**. Peppers default to hardcoded literals (`"abi-vercel-demo-pepper"` in `route.ts:85`; `"abi-dev-pepper-change-me"` in `secrets.ts:10`). `secretMatches` falls back to plaintext comparison for un-prefixed stored values (`secrets.ts:31`). `store.getSessionByToken` does `if (!scopes.length) scopes = ["read","pay","escrow"]` (`store.ts:1298-1301`) — an empty scope array silently grants **full money authority**.
**Current state.** A misconfigured session key escalates to full spend rights. A public constant serves as a production default.
**Desired state.** Boot-time assertion on pepper in production. Empty scopes → 403. Plaintext fallback removed once migration is verified.
**Reasoning.** Authorization must fail closed. This is a one-line class of bug with an outsized consequence.
**Dependencies.** None.
**Complexity.** S · **Priority.** High

### P1-T6 — Close the x402 SSRF surface
**Description.** Apply the existing `webhookUrlProblem` IP/host denylist to the x402 fetch path. Remove `localhost` from shipped policy templates.
**Problem.** Finding **M6**. `templateApiSeller()` ships `domainAllowlist: ["localhost"]` (`packages/policy/src/index.ts:456`) and `bootstrapDemo` adds `localhost` to the demo org (`store.ts:3456`). An agent can then drive server-side fetches to `http://localhost:*/…` via `pay_api`. Webhooks are protected by a thorough denylist (IPv6, CGNAT, cloud metadata, embedded credentials); the x402 rail is not.
**Current state.** `redirect: "error"` mitigates redirect pivots; the direct fetch is ungated.
**Desired state.** One shared outbound-URL guard used by webhooks, x402, and the compliance vendor webhook. Local sellers reachable only via an explicit dev-mode flag.
**Reasoning.** Reuses an existing, well-built control; closes the gap for near-zero cost.
**Dependencies.** None.
**Complexity.** S · **Priority.** Medium

---

## PHASE 2 — Runtime & Persistence Foundation

*Goal: writes are durable, concurrent requests are safe, and background work runs. This is the largest and most important phase.*

### P2-T1 — Deploy the API as a persistent service
**Description.** Run `apps/api` as a long-lived process (the `Dockerfile` and `docker-compose.yml` already exist). Vercel keeps the marketing site and console only; `/abi-api` becomes a thin proxy.
**Problem.** Finding **C2**, plus **C6, M1** and the entire dead-background-work class. `route.ts:102-136` performs, on **every request**: `closeDb()` → base64-decode the whole database from Vercel Runtime Cache → write to `/tmp` → reopen SQLite → serve → re-encode → upload to a single global key (`CACHE_KEY = "abi-sqlite-v1"`, `vercel-db-sync.ts:8`). This is read-modify-write on a shared blob with no CAS, lease, or version check. Concurrent requests each hydrate snapshot *N* and each persist; the loser's journals, payments, approvals, and idempotency reservations vanish **after** the caller received HTTP 200. The console itself fires four concurrent requests every 8 seconds (`console/page.tsx:383-435`), so the system cannot hold ledger integrity with one idle user. Additionally: every `setInterval` is gated behind `if (!embedded)` (`index.ts:2065-2106`), so in production `runDueSubscriptions` **never runs** (recurring payments silently never charge), the reconciliation watchdog never runs, Telegram polling never starts, and escrow/approval expiry only fire when a human loads the relevant tab. Webhook retries are `setTimeout`-scheduled after the response, so the frozen function never fires them and their status writes land after `persistDbToCache`. Finally, `maxDuration = 60` against `waitForTransactionReceipt({ timeout: 120_000 })` (`chain/transfer.ts:133`) means a slow confirmation kills the function mid-await and **discards every write from that request** — real USDC leaves the vault with no ledger record at all.
**Current state.** Every correctness guarantee `engine.ts` establishes is enforced inside a SQLite transaction on a file about to be silently overwritten.
**Desired state.** A single long-lived Node process (or a small horizontally-scaled set behind Postgres) owning the database connection, running background sweeps on real intervals, with no per-request database serialization anywhere.
**Reasoning.** This one change resolves eight distinct findings and is the precondition for every subsequent phase being meaningful. The `store.ts` seam was built for exactly this migration.
**Dependencies.** P0-T4 (CI), P0-T5 (tests).
**Complexity.** **L** · **Priority.** **Critical**

### P2-T2 — Migrate persistence to Postgres behind the `store.ts` seam
**Description.** Wire `packages/db` (Prisma schema exists, unused) as the production store; keep SQLite for local dev and tests.
**Problem.** Finding **C2** (durability half) and audit item **A14** in the team's own log, marked *deferred*. SQLite in a single process is a scaling ceiling and a single point of loss; the current Runtime Cache workaround exists *because* the storage choice did not fit the deployment.
**Current state.** All SQL lives behind `apps/api/src/store.ts` — a genuinely good boundary that makes this swap tractable. `packages/db` carries `@prisma/client` into every install for a schema nothing imports.
**Desired state.** `store.ts` has two implementations selected by config. Transactions are real database transactions. Row-level locking replaces best-effort CAS where appropriate.
**Reasoning.** Restores durability, enables horizontal scale, and lets the existing CAS/idempotency logic mean what it says.
**Dependencies.** P2-T1.
**Complexity.** **L** · **Priority.** **Critical**

### P2-T3 — Move background work to a real job runner
**Description.** Promote `apps/worker` (currently 13 lines) into the process that owns subscriptions, escrow timeouts, approval expiry, deposit sync, reconciliation, and webhook retries, with leader election or advisory locks so multiple API instances do not double-run.
**Problem.** Sweeps currently run inside the API process on `setInterval` and are skipped entirely when embedded. Once the API scales past one instance, unguarded intervals become a double-charge vector — precisely the class of bug the team already fixed once (audit item **A1**, `claimSubscriptionRun`).
**Current state.** `apps/worker` is a 13-line stub.
**Desired state.** Named jobs with schedules, advisory locking, per-job observability, and a dead-letter path for webhook deliveries with real exponential backoff.
**Reasoning.** Recurring payments, escrow auto-refund and approval expiry are money-affecting operations that must run whether or not anyone is looking.
**Dependencies.** P2-T1, P2-T2.
**Complexity.** M · **Priority.** **Critical**

### P2-T4 — Enforce tenant scoping at the store layer
**Description.** Make `orgId` a required parameter on every store read/write that can return tenant data; remove call-site-only checks.
**Problem.** Audit §7.2. Tenant isolation is currently enforced by ~30 hand-written `agent.orgId !== org.id` checks at call sites. Every one I audited is correct — but the pattern is fragile: a single omission in a future route is a cross-tenant data leak with no compile-time or test-time signal.
**Current state.** Correct today, one careless PR away from not being.
**Desired state.** `store.getAgent(orgId, agentId)` shape throughout; unscoped variants deleted. The type system prevents the mistake.
**Reasoning.** Multi-tenant isolation should be structural, not a discipline. Cheapest to enforce during the Postgres migration when every query is being touched anyway.
**Dependencies.** P2-T2.
**Complexity.** M · **Priority.** High

### P2-T5 — Test the money path
**Description.** Integration tests for `executeIntent`, `resolveApproval` + quorum, idempotency replay, escrow CAS, hold/settle/partial-release, guardian RBAC, and webhook signature verification.
**Problem.** Finding: coverage is inverted. Of 49 assertions, 17 cover the chat agent's intent classifier. **Zero** cover the ~900 most security-critical lines. The README's `security.mjs` claims (H9) describe exactly the behaviours that are untested.
**Current state.** The engine's guarantees are real — I verified them by reading source — but nothing prevents their regression.
**Desired state.** Every claim in the README security section is backed by a named test. Concurrency tests that would have caught the Runtime Cache lost-update class.
**Reasoning.** Phase 2 rewrites the storage layer beneath the money path. Doing that without tests is how a correct engine becomes an incorrect one.
**Dependencies.** P0-T4, P0-T5, P2-T2.
**Complexity.** **L** · **Priority.** **Critical**

---

## PHASE 3 — Identity & Access Control

*Goal: humans have accounts, organisations have members, and actions attribute to verified people.*

### P3-T1 — Real authentication system
**Description.** Users, organisations, memberships, invitations by email, server-side sessions, password/OAuth/magic-link sign-in. Auth.js or WorkOS.
**Problem.** Finding **C7**, plus missing features 1–6. There is no authentication system at all. No users, email, password, OAuth, SSO, MFA, server-side session, CSRF consideration, or account recovery. "Log in" is: paste a bearer key, or click a button that creates an organisation with **zero** authentication and returns root credentials (`login-view.tsx:151-184`). The founder guardian key lives in `localStorage` (`console/page.tsx:247,312`), never expires, and cannot be rotated.
**Current state.** Any XSS — including one introduced by a future dependency — is instant, permanent, total organisation compromise. There is no account recovery: lose the key, lose the funds. `README.md:264` lists "guardian login (Auth.js)" under *Next*; the product is live without it.
**Desired state.** People sign in as people. Bearer keys become machine credentials only, issued and revoked from an authenticated console. Guardian identity is a user, not a string.
**Reasoning.** No enterprise conversation survives its absence, and the audit trail is not an audit trail while `resolvedBy` is a free-text label (M9).
**Dependencies.** P2-T2 (needs a real database for users/sessions).
**Complexity.** **XL** · **Priority.** **Critical**

### P3-T2 — Move credentials out of browser storage
**Description.** httpOnly, SameSite cookie sessions for the console. `localStorage` holds no secrets.
**Problem.** Finding **C7** (storage half). Guardian key persisted in `localStorage` under `pv_session`, read on every mount.
**Current state.** XSS-exfiltratable root credential with no expiry.
**Desired state.** Session cookie; CSRF protection on mutating routes; explicit sign-out that invalidates server-side.
**Reasoning.** Removes the highest-probability path to total compromise.
**Dependencies.** P3-T1.
**Complexity.** M · **Priority.** **Critical**

### P3-T3 — Step-up authentication on approvals
**Description.** Require MFA re-authentication for approvals above a configurable threshold, and for policy changes, key rotation, and withdrawal.
**Problem.** Finding **M9** and missing feature 2. Whoever holds the bearer key approves any payment. `resolvedBy` defaults to the literal string `"guardian"` (`index.ts:1556`) and is whatever the client sends.
**Current state.** The human-in-the-loop control has no proof of which human.
**Desired state.** High-value approvals require a fresh second factor. The audit record names a verified user.
**Reasoning.** The approval gate is ABI's core safety claim. Without identity behind it, it gates possession of a string, not a decision by a person.
**Dependencies.** P3-T1.
**Complexity.** M · **Priority.** High

### P3-T4 — Role and permission model
**Description.** Extend beyond `owner`/`approver`/`viewer` to custom roles with scoped permissions (treasury, policy, agents, approvals, billing) and per-role approval limits.
**Problem.** Missing feature 5. Current roles are coarse; `ownerOnly` is a boolean on routes. The existing per-guardian `conditions.maxApproveUsdc` (`engine.ts:510`) is a good primitive with no general model around it.
**Current state.** Adequate for a two-person team, insufficient for a finance function.
**Desired state.** Permission checks derive from role definitions; the console renders only permitted actions; changes are audited.
**Reasoning.** Required by any organisation where the person who sets policy is not the person who approves payments — which is the entire point of segregation of duties in finance.
**Dependencies.** P3-T1.
**Complexity.** L · **Priority.** High

### P3-T5 — Account recovery and break-glass
**Description.** Owner recovery via verified email + MFA; documented break-glass for a lost sole-owner account; guardian key rotation.
**Problem.** Missing features 3–4. No recovery exists. The login screen honestly warns that clearing browser data signs you out permanently.
**Current state.** Lose the guardian key → lose the organisation and its funds, irreversibly.
**Desired state.** Recovery without support intervention for the common case; an audited, rate-limited manual path for the rest.
**Reasoning.** "Do not lose this string or your money is gone" is not a product an organisation adopts.
**Dependencies.** P3-T1, P3-T2.
**Complexity.** M · **Priority.** High

---

## PHASE 4 — Custody & Key Management

*Goal: ABI does not hold raw private keys, and the CDP claim becomes true.*

### P4-T1 — Adopt a managed custody provider
**Description.** Implement `CustodyProvider` against Coinbase CDP Server Wallets (fallback: Privy or Turnkey). Migrate existing org vaults.
**Problem.** Findings **C3, C4, C5, H6, H7**, missing features 7–8, 10–11, 13, and product risk **R3**. `CdpVaultProvider` (`packages/custody/src/index.ts:91-120`) is `DevLocalProvider` with a renamed `name` field — same `lookup`, same `sign`, reading a plaintext key from SQLite and signing with viem. There is no `@coinbase/cdp-sdk`, no `@coinbase/coinbase-sdk`, no Coinbase HTTP call in the monorepo. `store.createOrg` writes the raw private key to `vaults.private_key` (`store.ts:1176-1182`) — API keys got the A13 hashing treatment, the money-controlling secrets did not. `EvmUsdcTransferRail` creates a fresh viem client per call and lets viem fetch the nonce (`chain/transfer.ts:62-68`), so two agents paying concurrently (permitted at `maxPaysPerMinute: 10`) collide on nonce and one transaction silently replaces the other. Each vault is a bare EOA that must hold native ETH, with no top-up, sponsorship, or paymaster.
**Current state.** Self-custodied hot EOAs, plaintext, in a shared cache blob, with no nonce or gas management.
**Desired state.** Keys live in MPC/HSM custody. ABI holds an API credential, never a private key. Nonce sequencing and gas are the provider's responsibility. `getAddress`/`signTypedData` semantics unchanged — the seam already anticipates this.
**Reasoning.** Resolves five findings at once, makes the marketing claim true rather than merely reworded, deletes ABI's largest regulatory and operational liability, and — per **R3** — refocuses the team on the policy/approval layer that is actually differentiated.
**Dependencies.** P2-T2 (migration needs a durable store), P0-T2 (claims corrected in the interim).
**Complexity.** **XL** · **Priority.** **Critical**

### P4-T2 — Encrypt keys at rest (interim + dev)
**Description.** KMS-envelope encryption for any key material ABI still holds, including the dev-local provider.
**Problem.** Finding **C4**. If P4-T1 slips, plaintext keys persist. Local development also generates real keypairs stored in plaintext.
**Current state.** No encryption anywhere.
**Desired state.** Keys encrypted at rest with an external KMS; decryption only inside the signing boundary; key material never logged or serialised into a cache blob.
**Reasoning.** Insurance against P4-T1 slipping, and correct hygiene for developer machines regardless.
**Dependencies.** None (independent of P4-T1).
**Complexity.** M · **Priority.** High

### P4-T3 — Gas management and monitoring
**Description.** Track native-token balance per vault; alert below threshold; automate top-up or use provider gas sponsorship / paymaster.
**Problem.** Finding **H7**, missing feature 10. The failure surfaces mid-mission as `INSUFFICIENT_GAS` with a message telling the user to go fund an address manually (`chain/transfer.ts:117-121`).
**Current state.** Agents cannot operate unattended — which contradicts the product's central premise.
**Desired state.** Gas is invisible to the customer. Low balance raises an alert well before it blocks a payment.
**Reasoning.** "Autonomous agents" that halt because a human did not top up an EOA are not autonomous. Also removes ERC-4337 from the "claimed but absent" list, either by building it or by dropping the claim (P0-T2).
**Dependencies.** P4-T1 (provider may supply this).
**Complexity.** M · **Priority.** High

### P4-T4 — Wallet connection for customer-controlled funds
**Description.** Support connecting an external wallet (WalletConnect / Coinbase Wallet / Privy embedded) as a funding source and withdrawal destination.
**Problem.** User-journey step 5 — **missing entirely**, missing feature 9. There is no wallet connection anywhere in the product: no WalletConnect, RainbowKit, Privy, or Coinbase Wallet SDK. ABI generates a custodial EOA the customer cannot see, export, or control.
**Current state.** The vision step "connect a wallet" does not exist as a concept in the codebase.
**Desired state.** Customers fund from and withdraw to wallets they control, with the ABI vault as an operational float rather than the only account.
**Reasoning.** Crypto-native buyers will not accept opaque custody of their treasury. It is also the honest path if full custody proves regulatorily expensive.
**Dependencies.** P4-T1, P3-T1.
**Complexity.** L · **Priority.** Medium

---

## PHASE 5 — Settlement Correctness

*Goal: every payment that leaves is recorded, and x402 works against real infrastructure.*

### P5-T1 — Correct the EIP-712 domain per network
**Description.** Resolve the USDC EIP-712 domain (`name`, `version`) per chain at runtime — ideally by reading `eip712Domain()` from the token contract — instead of hardcoding.
**Problem.** Audit §7.4(a). `eip712Domain` hardcodes `name: "USD Coin", version: "2"` for **both** networks (`rails/x402.ts:69-76`). Base Sepolia's USDC (`0x036CbD…`) uses `name: "USDC"`. The dev facilitator hardcodes the *same wrong domain* (`x402-seller/src/index.ts:100-105`), so the loop verifies against itself and passes. Against a real facilitator or the actual token contract, signature recovery fails.
**Current state.** Strong evidence the x402 rail has never settled on a real network, notwithstanding what the docs claim.
**Desired state.** Domain derived from chain configuration or the contract. Verified against Base Sepolia USDC.
**Reasoning.** This single constant is the difference between a demo and a payment.
**Dependencies.** None.
**Complexity.** S · **Priority.** **Critical**

### P5-T2 — Settle x402 against a real facilitator
**Description.** Point the client at Coinbase's hosted x402 facilitator; adopt the official `x402` packages where they fit; keep the local seller as a dev fixture only. Publish a real Base Sepolia settlement transaction hash as proof.
**Problem.** Finding **M2**, missing item. Buyer (`rails/x402.ts`), seller and facilitator (`apps/x402-seller`) are all ABI code. The dev facilitator "verifies signatures cryptographically and fakes onchain settlement" with `randomBytes` as the tx hash. No `x402` / `x402-fetch` / `x402-express` dependency exists.
**Current state.** A self-referential loop presented as ecosystem compatibility.
**Desired state.** A verifiable on-chain x402 settlement, linked from the docs.
**Reasoning.** "x402-compatible" is a headline vision pillar and one of two things a technical evaluator will check. Also note §7.4(b): `pay` to a bare `0x` bypasses x402 entirely and takes the direct ERC-20 rail (`engine.ts:320-330`) — so the existing `docs/E2E-ONCHAIN-AGENT-PAY.md` proof demonstrates the transfer rail, not x402. Both need separate evidence.
**Dependencies.** P5-T1, P4-T1.
**Complexity.** L · **Priority.** **Critical**

### P5-T3 — Durable, resumable settlement state machine
**Description.** Persist intent state (`held → broadcast → confirming → settled | failed`) before broadcast; a background reconciler resumes any intent left mid-flight.
**Problem.** Finding **C6**. `waitForTransactionReceipt({ timeout: 120_000 })` (`chain/transfer.ts:133`) against `maxDuration = 60` (`route.ts:8`). Because the database persists only *after* the response, a slow confirmation kills the function and discards **all** of that request's writes — including the hold. Real USDC leaves the vault and the ledger contains no record. Every downstream balance, report and reconciliation is then silently wrong.
**Current state.** Even after P2-T1 removes the serverless timeout, a process restart mid-confirmation produces the same orphan.
**Desired state.** The transaction hash is durably recorded *before* broadcast completes. A crash at any point is recoverable by replaying against chain state.
**Reasoning.** Irreversible external side effects require a durable state machine, not an in-request `await`. This is the single most likely way ABI loses real money in normal operation.
**Dependencies.** P2-T1, P2-T2, P2-T3.
**Complexity.** L · **Priority.** **Critical**

### P5-T4 — Transaction queue with nonce sequencing
**Description.** Serialise outbound transactions per vault with managed nonces, replacement/bump on stuck transactions, and a retry policy.
**Problem.** Finding **H6**. Concurrent transfers from one vault fetch the same nonce; one silently replaces the other while the ledger records both.
**Current state.** Multi-agent concurrency — the product's core use case — is unsafe on-chain.
**Desired state.** Ordered, observable outbound queue per vault. Duplicate-suppression via the existing idempotency key.
**Reasoning.** An agent-spending platform is a concurrency product by definition.
**Dependencies.** P4-T1 (provider may supply), P5-T3.
**Complexity.** L · **Priority.** High

### P5-T5 — Mark and segregate simulated settlement
**Description.** Persist the settling rail on the decision/journal row; render "simulated" distinctly everywhere; confine the mock rail to an explicit demo mode.
**Problem.** Finding **H5**. Any `pay` to a non-`0x`, non-URL destination silently routes to `TransferMockRail`, returning `settled: true` with `txHash: "0xmock_…"`. The ledger, decisions, vendor analytics, P&L, and webhooks treat it identically to a real settled payment. The rail name appears in the response payload but is **not persisted on the decision row**, so history cannot be filtered to money that actually moved.
**Current state.** Real and fabricated spend are indistinguishable in the books after the fact.
**Desired state.** Simulated money is visibly simulated, permanently, at every surface — and cannot be enabled in a production organisation.
**Reasoning.** Directly enables H4 (reconciliation) and removes a serious trust hazard.
**Dependencies.** P2-T2.
**Complexity.** M · **Priority.** High

---

## PHASE 6 — Policy & Programmable Budgets

*Goal: deliver the headline capability — per-agent programmable budgets that are actually enforced.*

### P6-T1 — Scoped policy resolution (org → group → agent)
**Description.** Layered policy: organisation defaults, optional group overrides, optional per-agent overrides, resolved deterministically with provenance on every decision. Add a true org-level aggregate cap.
**Problem.** Findings **H1** and **H2**, missing features 16–17. `rulesFor(agentId, orgId)` reads exactly one template: `store.getPolicyTemplate(orgId)` (`engine.ts:49`). Per-tx max, daily max, allowlists, quiet hours, HITL threshold and velocity are all **org-wide**. The only per-agent controls are the ledger stipend and the freeze flag. Separately, `dailyMaxMicro` is applied against `spentLast24h(agentId)` — per agent — so twenty agents under a "$50 daily max" can spend $1,000/day, with no org ceiling anywhere.
**Current state.** The vision statement ("assign programmable budgets"), the landing page ("Each agent gets its own wallet and budget… rules the AI cannot talk its way around"), and the enforcement layer disagree.
**Desired state.** Each agent can carry its own caps, allowlists, HITL threshold, and quiet hours; unset fields inherit. Decisions record which layer produced each rule. An org-level daily/weekly/monthly ceiling binds the aggregate.
**Reasoning.** This is the largest *product* gap in the audit and the clearest instance of promise-versus-reality. It is also the feature most likely to close a design partner.
**Dependencies.** P2-T2 (schema), P2-T5 (tests before touching the engine).
**Complexity.** **L** · **Priority.** **Critical**

### P6-T2 — Fix policy primitives that do not behave as labelled
**Description.** Make `newCounterpartyCooldownHours` a real time window; make quiet hours timezone-aware; restore daily-cap headroom on escrow refund; correct policy-version attribution on restore.
**Problem.** Findings **M7, M8, L4, M10**. `newCounterpartyCooldownHours` is treated as a boolean — any nonzero value forces `review` regardless of hours, and the code says so (`packages/policy/src/index.ts:269-275`) while the UI presents an hours field. `inQuietHours` reads `getUTCHours()` (`:95`) with no org timezone, so an APAC customer setting 22:00–06:00 gets a window in the middle of their working day. `escrow_lock` calls `recordPay(agentId, authorizedMicro)` at lock time (`engine.ts:188`), so a locked-then-refunded escrow permanently consumes daily-cap headroom. `restorePolicyVersion` may leave decisions attributed to a version string that no longer describes the active rules.
**Current state.** Four controls whose behaviour differs from their label.
**Desired state.** Every control does what its name and UI say.
**Reasoning.** In a policy product, a control that lies is worse than a control that is absent — the customer believes they are protected.
**Dependencies.** P6-T1.
**Complexity.** M · **Priority.** High

### P6-T3 — Spend categories and counterparty risk
**Description.** Merchant categorisation with category-level caps; counterparty risk scoring beyond binary allowlist, incorporating first-seen date, volume, and screening results.
**Problem.** Missing features 18–19. Policy is amount + destination + time. There is no notion of *what* the money is for.
**Current state.** `merchants` table and `known_counterparties` exist as the right primitives, unused for policy.
**Desired state.** "Cap inference spend at $200/day, but never cap security tooling" is expressible.
**Reasoning.** How finance teams actually think about budgets. Also a differentiator against generic agent wallets.
**Dependencies.** P6-T1.
**Complexity.** L · **Priority.** Medium

### P6-T4 — Time-boxed and purpose-boxed budgets
**Description.** Budgets with start/end dates, total ceilings, expiry, and automatic reclaim of unspent funds.
**Problem.** Missing feature 21. Budgets are perpetual envelopes.
**Current state.** `departments`, `agent_groups`, `auto-fund` provide the plumbing; no time dimension.
**Desired state.** "This campaign gets $5,000 through March 31, then stops."
**Reasoning.** Matches how project and campaign budgets work, and provides a natural safety expiry for agents nobody remembers deploying.
**Dependencies.** P6-T1.
**Complexity.** M · **Priority.** Medium

---

## PHASE 7 — Treasury Integrity & Reconciliation

*Goal: every dollar in the ledger traces to a real event, and the books can be proven against the chain.*

### P7-T1 — Backed-balance model with on-chain reconciliation
**Description.** Remove the ability to mint unbacked ledger balance; make withdrawal actually broadcast; add continuous reconciliation of `org:available` against real vault holdings with a drift alarm.
**Problem.** Findings **H3, H4, H5**, missing features 12, 14. `POST /v1/guardian/treasury/deposit` credits `org:available` from the `external` contra account by any amount with no on-chain event (`treasury-routes.ts:582-597`). "Withdraw" is the mirror image and **broadcasts nothing** (`:630`). The UI labels this honestly ("Demo books only — does NOT broadcast on-chain") but the success toast then says *"Sent 10 USDC from the vault."* Phantom balance flows straight into allocations, Insights, P&L, burn forecast and invoices with no marker. Meanwhile `reconcileOrgUncached` (`store.ts:3299`) replays journals against account balances — it proves the books agree with *themselves* and never compares against the vault's actual on-chain USDC. Combined with the mock rail, the ledger can be arbitrarily divergent from reality while reconciliation reports `ok: true`.
**Current state.** "Complete auditability" currently means "internally consistent", which is not what a CFO means by it.
**Desired state.** Ledger credits originate only from observed on-chain deposits or explicit, marked demo mode. Withdrawal broadcasts. A scheduled job compares ledger totals to chain state and raises a drift alarm that reaches a human.
**Reasoning.** This is the difference between an accounting system and a spreadsheet. It is also the precondition for any customer trusting the reports.
**Dependencies.** P2-T3 (job runner), P5-T5 (rail marking), P5-T3 (durable settlement).
**Complexity.** **L** · **Priority.** **Critical**

### P7-T2 — Clarify the funding experience
**Description.** One funding surface with a clear primary path (send USDC to the vault → auto-credit) and demo-only paths visibly quarantined or removed from production organisations.
**Problem.** User-journey step 6. Two contradictory funding paths sit on the same screen; new users will use the fake one and believe they funded something.
**Current state.** Auto-credit from on-chain deposits works well, with good polling UX. It is undermined by sitting beside a mint button.
**Desired state.** In a production org there is exactly one way to add money, and it is real.
**Reasoning.** The single most likely place a new user forms a false belief about their own balance.
**Dependencies.** P7-T1.
**Complexity.** M · **Priority.** High

### P7-T3 — Treasury operations depth
**Description.** Multi-chain and multi-asset settlement; scheduled and batch treasury moves hardened against the new settlement machine.
**Problem.** Missing feature 15. Base + USDC only. Multi-asset holdings exist in the UI but are manually recorded, not chain-backed.
**Current state.** `assets`, `org_asset_balances`, `vault_asset_events` tables exist; only USDC has a real adapter.
**Desired state.** Chain adapters per asset; the manual-record path retired.
**Reasoning.** Needed for real treasury management, but strictly after single-asset correctness is proven.
**Dependencies.** P7-T1, P5-T3.
**Complexity.** L · **Priority.** Medium

---

## PHASE 8 — Agent System & Runtime Integration

*Goal: agents are first-class, observable, and easy to connect from real frameworks.*

### P8-T1 — Agent identity and lifecycle hardening
**Description.** Consolidate agent identity, session-key scopes, group membership, and profile into a coherent model with a documented lifecycle.
**Problem.** The agent surface is the best-built area of the product (create → key-once → profile → groups → session keys → freeze/archive/rotate), but it accumulated across phases and now carries a `@deprecated` field (`agent-routes.ts:105`) and an overlapping group/department/budget model that the team's own ADR (`docs/decisions/2026-07-21-budgets-vs-team-membership.md`) had to be written to disambiguate.
**Current state.** Works; conceptually crowded.
**Desired state.** One documented model, deprecated fields removed, the ADR's "Picture A" reflected in code and UI naming.
**Reasoning.** Phase 6 layers policy onto this hierarchy. Clarify it before adding to it.
**Dependencies.** P6-T1.
**Complexity.** M · **Priority.** High

### P8-T2 — Per-tenant control over LLM data egress
**Description.** Make the chat assistant opt-in per organisation, support customer-supplied model credentials, disclose egress in the UI, and offer a fully-local fallback.
**Problem.** Finding **M4**. `runLlmToolLoop` posts a system prompt containing balances, agent names, spend figures and remembered facts to `api.openai.com` using a **platform-level** `OPENAI_API_KEY` (`abi-agent/llm-loop.ts:228-285`), enabled by default (`ABI_CHAT_AGENT !== "0"`). No per-tenant opt-out, no DPA surface, no data-residency control, no disclosure.
**Current state.** An enterprise security questionnaire fails on this line alone.
**Desired state.** Organisations choose whether their financial data leaves the platform, to whom, and can turn it off entirely — the keyword fallback path already exists and works.
**Reasoning.** Enterprise blocker. Also a strong trust signal if handled well and disclosed prominently.
**Dependencies.** P3-T1 (per-org settings need real orgs).
**Complexity.** M · **Priority.** High

### P8-T3 — Complete or retire the external-actions stub
**Description.** Either implement browser execution for approved external actions, or remove the surface and its UI.
**Problem.** `external-actions.ts`, `abi-agent/tools.ts:717`, `index.ts:1048-1069` — "queued for browser execution (stub; nothing posted yet)". A guardian approves an action and nothing happens.
**Current state.** A HITL flow that terminates in a no-op. Correctly labelled, but a user who approves reasonably expects an effect.
**Desired state.** Either it works, or it is not in the product.
**Reasoning.** Approval flows that do nothing erode the credibility of the approval flows that do.
**Dependencies.** P3-T1.
**Complexity.** M (retire: S) · **Priority.** Medium

### P8-T4 — Agent runtime adapters
**Description.** First-class integrations for LangChain, CrewAI, the OpenAI Agents SDK, and the Vercel AI SDK, alongside the existing MCP server.
**Problem.** Missing feature 30. The MCP server is good and correctly scoped. Everything else requires hand-rolling HTTP.
**Current state.** REST + private TS SDK + MCP.
**Desired state.** `pip install abi-sdk` / `npm i @abi/sdk` and a three-line tool registration in the framework the customer already uses.
**Reasoning.** This is where adoption actually happens for an agent-infrastructure product.
**Dependencies.** P10-T1 (SDK publication), P0-T3 (naming settled).
**Complexity.** L · **Priority.** High

---

## PHASE 9 — Console, UX & Accessibility

*Goal: the strongest dimension of the product becomes launch-grade.*

### P9-T1 — Onboarding rebuild
**Description.** Replace paste-a-token entry with sign-up → verify → create organisation → guided setup (fund → create agent → set policy → first payment), and make the intro animation non-blocking.
**Problem.** User-journey steps 2–4. A **4.2-second** blocking vault animation gates the primary action (`login-view.tsx:12`) — skippable and reduced-motion aware, but the first impression for an enterprise buyer is a cinematic. Onboarding itself is "paste a bearer token", with no password manager integration, no SSO, and no team invite.
**Current state.** The key-reveal card (copy / download / acknowledge) is genuinely well-designed and should be kept for machine credentials.
**Desired state.** Time-to-first-payment under five minutes, with a checklist that shows what remains.
**Reasoning.** Onboarding is where the vision either lands or does not, and it currently signals "developer toy".
**Dependencies.** P3-T1, P3-T2.
**Complexity.** L · **Priority.** High

### P9-T2 — Component and styling consolidation
**Description.** Retire the third styling system; move inline styles into the design system; adopt one icon set; delete unused primitives.
**Problem.** Audit §9. **431 inline `style={{}}` objects** compete with a 7,027-line `globals.css` and an installed-but-largely-bypassed Tailwind. Two icon systems coexist: a custom `Icon` component (75 usages) and `lucide-react` (used only inside three shadcn primitives). `alert.tsx` has zero importers; `dialog.tsx` and `label.tsx` are used only transitively by `command.tsx` / `form.tsx`.
**Current state.** The visual result is coherent; the implementation is not, and will not survive a design-system pass or a second frontend contributor.
**Desired state.** One styling approach, one icon set, tokens in one place, unused primitives deleted.
**Reasoning.** Every UX task after this is cheaper once it is done — and more expensive if the codebase keeps growing first.
**Dependencies.** P0-T1.
**Complexity.** L · **Priority.** Medium

### P9-T3 — Accessibility to WCAG 2.1 AA
**Description.** Full audit and remediation: focus management, dialog focus traps, skip links, keyboard paths, contrast, screen-reader labelling, motion preferences.
**Problem.** Audit §9. 81 `aria-*` and 13 `role=` attributes across 17k lines of view code is thin. **47 `<button>` elements lack an explicit `type`** (finding L5), so inside forms they default to submit and cause accidental submissions. No skip link, no documented focus-trap audit, no stated WCAG target.
**Current state.** Partial and unmeasured. Reduced-motion handling in 11 places is a genuinely good start.
**Desired state.** A stated WCAG 2.1 AA target, automated axe checks in CI, and a documented manual audit.
**Reasoning.** Required by enterprise procurement and public-sector buyers; the right thing regardless.
**Dependencies.** P9-T2.
**Complexity.** L · **Priority.** High

### P9-T4 — Rendering strategy and performance
**Description.** Introduce server components for initial data; replace the 8s/30s polling fan-out with SSE or WebSocket; split the console bundle by route.
**Problem.** Audit §2.3, §9. Every page is `"use client"`; no server components, no SSR data, no streaming. `/console` is 163 kB route / 320 kB first load and is blank until JS hydrates and the first poll returns. The client polls **14 endpoints** on two timers (`console/page.tsx:383-435`). `console/page.tsx` is a 1,074-line component with ~30 `useState` hooks; `treasury-view.tsx` is 1,506 lines; `agents-view.tsx` 1,429.
**Current state.** The polling implementation is thoughtful — fingerprinted diffs, pauses on hidden tabs — but it is compensating for the wrong architecture, and after P2-T1 it becomes 14 requests against a real service.
**Desired state.** First meaningful paint without waiting on JS + a round trip. Push-based updates. Views decomposed to a reviewable size.
**Reasoning.** Also materially reduces backend load once the API is a real service being billed for.
**Dependencies.** P2-T1.
**Complexity.** L · **Priority.** Medium

### P9-T5 — Information architecture review
**Description.** Revisit navigation before adding Phase 6/7 surfaces.
**Problem.** Audit §9. 16 views across 10 rail entries with alias routing (`canonicalView`, `tabForAliasView`). Coherent today; one feature from needing revision.
**Current state.** Money / Agents / Records / Config is the right first cut.
**Desired state.** An IA that absorbs per-agent policy, budgets, categories, and compliance without a rail rewrite.
**Reasoning.** Cheaper to revise before four new surfaces land than after.
**Dependencies.** P6-T1, P7-T1 (know what must fit).
**Complexity.** M · **Priority.** Medium

### P9-T6 — Mobile approvals, properly
**Description.** Ship push notifications and a real mobile approvals experience — or delete `apps/mobile` and keep the `/approvals` web route as the mobile surface.
**Problem.** Audit §9, missing feature 33. `apps/mobile` is orphaned (not in `workspaces`, not in the lockfile, not in the build), a single-file Expo app whose own comment concedes push is unimplemented. Approvals expire in 10 minutes by default; without push, mobile approval is not a workflow.
**Current state.** Half a feature in two places.
**Desired state.** One mobile approval path that works, with push.
**Reasoning.** Approve-on-the-go is a genuinely compelling story for this product — and currently it is the only story in the repo that is shipped but non-functional in both implementations.
**Dependencies.** P3-T1 (identity for device registration).
**Complexity.** L (delete: S) · **Priority.** Medium

---

## PHASE 10 — Developer Experience & Distribution

*Goal: a developer can integrate in fifteen minutes without cloning the monorepo.*

### P10-T1 — Publish the TypeScript SDK
**Description.** Publish under the settled brand with semver, changelog, typed errors, retry semantics, and generated reference docs.
**Problem.** Missing feature 28. `@policyvault/*` are private workspace packages. Integrating today requires cloning the monorepo.
**Current state.** The SDK itself is good — `PolicyVaultClient`, `AbiGuardianClient`, `waitForApproval` — and unreachable.
**Desired state.** `npm i @abi/sdk`.
**Reasoning.** The gap between "good SDK" and "usable SDK" is one publish step.
**Dependencies.** P0-T3 (naming must be final before the first published version).
**Complexity.** M · **Priority.** High

### P10-T2 — Python SDK
**Description.** A first-class Python client with parity, idiomatic errors, async support, and framework helpers.
**Problem.** Missing feature 29. The AI-agent ecosystem — LangChain, CrewAI, AutoGen, the OpenAI Agents SDK — is majority Python. There is no Python client.
**Current state.** TypeScript only.
**Desired state.** `pip install abi-sdk`.
**Reasoning.** **This is a GTM blocker, not a nice-to-have.** The majority of the target market cannot use the product today without hand-rolling HTTP.
**Dependencies.** P0-T3.
**Complexity.** L · **Priority.** **Critical** (for adoption)

### P10-T3 — Developer portal and API documentation
**Description.** Generate reference docs from the existing OpenAPI document; add quickstarts, runnable examples, webhook verification snippets in several languages, and an API changelog.
**Problem.** `openapi.ts` exists and is served at `/v1/openapi.json`, but there is no rendered documentation and no versioning policy. The webhook signature scheme is documented only in the README.
**Current state.** `apps/demo-agent` is a good runnable example nobody will find.
**Desired state.** A documentation site a developer can succeed from without reading source.
**Reasoning.** For a developer-first infrastructure product, docs are the product surface.
**Dependencies.** P10-T1, P0-T6.
**Complexity.** M · **Priority.** High

### P10-T4 — Self-service credential management
**Description.** API key management in the console — create, scope, rotate, revoke, last-used, expiry — for both machine credentials and session keys.
**Problem.** Missing feature 31. Key management is spread across agent routes and reveal-once modals; there is no single place to see what exists and what it can do.
**Current state.** The primitives are all built (rotate, revoke, scoped session keys with expiry). They lack a home.
**Desired state.** One credentials screen, with visibility into which key made which call.
**Reasoning.** A basic expectation of any API product, and a prerequisite for incident response.
**Dependencies.** P3-T1, P3-T4.
**Complexity.** M · **Priority.** High

### P10-T5 — Local development experience
**Description.** One-command local stack (Postgres, API, worker, web, seller) via Compose; seeded fixtures; documented setup verified on a clean machine on all three platforms.
**Problem.** README quick-start references a path on another machine (`cd .`); `npm test` does not work from a clean clone; `docker-compose.yml` exists but is not the documented path.
**Current state.** Onboarding a second developer would take a day.
**Desired state.** Clone → `docker compose up` → working stack with seed data.
**Reasoning.** Prerequisite for a second contributor, and for any external audit or pen test.
**Dependencies.** P2-T1, P2-T2, P0-T6.
**Complexity.** M · **Priority.** High

---

## PHASE 11 — Compliance & Enterprise Readiness

*Goal: pass a real security review and a real compliance review.*

### P11-T1 — Real sanctions and transaction screening
**Description.** Implement `ComplianceScreener` against a real provider (Chainalysis, TRM, or an OFAC data source); fail closed by default; record screening results on the decision.
**Problem.** Finding **M3**, missing features 22–23. The default `EnvDenylistScreener` reads a comma-separated environment variable (`platform/compliance.ts:41`). No OFAC list, no sanctions data, no KYT, no vendor adapter. `ABI_COMPLIANCE_FAIL_CLOSED` defaults off.
**Current state.** The seam is well-designed and nothing is behind it.
**Desired state.** Every destination is screened before settlement; hits are blocked, recorded, and reportable.
**Reasoning.** Blocking for any regulated customer and any mainnet operation with third-party funds.
**Dependencies.** P4-T1, P5-T3.
**Complexity.** L · **Priority.** **Critical** (for launch)

### P11-T2 — KYB onboarding and Travel Rule
**Description.** Business verification at organisation creation; Travel Rule data handling for qualifying transfers.
**Problem.** Missing features 24–25, product risk **R4**. Custodying customer USDC in the US is money transmission. The `LEGAL_FOOTER` disclaimer is a good instinct and legally insufficient.
**Current state.** Anyone can create an organisation with a name string.
**Desired state.** Verified business identity before custody; jurisdiction recorded; Travel Rule payloads where required.
**Reasoning.** Regulatory prerequisite. Should be scoped with counsel, and its answer may change the P4-T4 custody strategy.
**Dependencies.** P3-T1, P4-T1. **Requires legal input, not just engineering.**
**Complexity.** XL · **Priority.** High

### P11-T3 — Enterprise access: SSO, SAML, SCIM
**Description.** SAML/OIDC SSO, SCIM provisioning, enforced MFA policy, session policy.
**Problem.** Missing feature: enterprise access controls. Audit §9 — security review terminates here.
**Current state.** None.
**Desired state.** Provisioning and deprovisioning through the customer's IdP.
**Reasoning.** Non-negotiable for enterprise procurement; typically the first question on the questionnaire.
**Dependencies.** P3-T1.
**Complexity.** L · **Priority.** High

### P11-T4 — Tamper-evident audit log and data governance
**Description.** Append-only audit log with integrity proofs; retention and deletion policies; data-residency options; export in a standard format.
**Problem.** Missing features 26, plus the H4 auditability gap. Decisions, journals, votes, freezes and policy versions are all recorded and exportable — but mutable, with no retention policy and no GDPR deletion path.
**Current state.** Good raw material, no governance.
**Desired state.** Auditors can verify the log has not been altered; customers can exercise data rights.
**Reasoning.** Required by SOC 2 and GDPR, and it is what "complete auditability" must mean for a paying customer.
**Dependencies.** P2-T2, P3-T1.
**Complexity.** L · **Priority.** High

### P11-T5 — Third-party penetration test and remediation
**Description.** Commission an external pen test covering the API, console, custody boundary, and payment rails. Remediate and re-test.
**Problem.** Product risk **R5**: the money path has had no independent human review, and 116 of 108 commits are agent-authored.
**Current state.** This audit is a code review, not a pen test. Both are needed.
**Desired state.** A clean report, or a remediated one.
**Reasoning.** No customer should be the first party to test this in production.
**Dependencies.** Phases 1–8 complete.
**Complexity.** M (coordination) · **Priority.** **Critical** (for launch)

### P11-T6 — SOC 2 Type I readiness
**Description.** Control definition, evidence collection, access reviews, vendor management, incident response, change management.
**Problem.** Missing feature: certification path. No control framework exists.
**Current state.** CI (P0-T4) and audit logging (P11-T4) are the first two controls; nothing formalises them.
**Desired state.** Type I achievable within one observation window.
**Reasoning.** Enterprise contracts require it; starting late costs a quarter.
**Dependencies.** P0-T4, P11-T4, P3-T4.
**Complexity.** XL · **Priority.** Medium

---

## PHASE 12 — Launch Preparation

### P12-T1 — Production observability and alerting
**Description.** Wire the existing `recordObs` / Prometheus sink into a real monitoring stack; alert on drift, failed settlement, stuck approvals, gas floor, webhook failure, and job lag.
**Problem.** `platform/observability.ts` and `/metrics` exist and are unconnected to anything that pages a human.
**Current state.** Metrics with no consumer.
**Desired state.** Money-affecting failures reach a person within minutes.
**Reasoning.** Financial incidents are only cheap while they are small.
**Dependencies.** P2-T1, P2-T3.
**Complexity.** M · **Priority.** **Critical** (for launch)

### P12-T2 — Incident response and status communication
**Description.** Runbooks for the money-path failure modes (settlement stuck, drift detected, custody unavailable, gas exhausted), an on-call rotation, a public status page, and a stated SLA.
**Problem.** Missing feature 34.
**Current state.** None.
**Desired state.** A documented, rehearsed response for each failure the system can produce.
**Reasoning.** A financial platform without an incident process will have its first incident in public.
**Dependencies.** P12-T1.
**Complexity.** M · **Priority.** High

### P12-T3 — Billing and metering
**Description.** Usage metering, plans, subscription billing, invoicing.
**Problem.** Missing feature 32. The pricing page offers Free / Contact / Contact with no billing infrastructure behind it.
**Current state.** Pre-revenue by construction.
**Desired state.** Self-service paid plans.
**Reasoning.** Deliberately late — pricing should follow evidence from beta usage, not precede it.
**Dependencies.** P3-T1, P12-T1.
**Complexity.** L · **Priority.** Medium

### P12-T4 — Load and chaos testing
**Description.** Sustained-load testing of the money path; fault injection on custody, RPC, and database; verify no double-spend, no lost writes, no orphan holds.
**Problem.** `apps/api/scripts/stress-probe.mjs` exists, is bound to no npm script, and predates the Phase 2 rewrite.
**Current state.** Concurrency correctness is asserted, not measured.
**Desired state.** Documented behaviour under load and under partial failure, with evidence.
**Reasoning.** The failure this catches — lost updates under concurrency — is exactly the class that produced C2.
**Dependencies.** P2-T5, P5-T3, P5-T4.
**Complexity.** L · **Priority.** High

### P12-T5 — Legal, positioning and naming review
**Description.** Counsel review of the "Artificial Banking Incorporated" name, disclaimers, and terms. Decide the token's relationship to the company.
**Problem.** Product risks **R4, R6, R7**. The name invites banking-regulator attention for a product explicitly not a bank. `contracts/AbincToken.sol` plus `docs/LAUNCH.md` references to pump.fun sit beside an unfinished financial product — correctly firewalled in code ("not wired into the console or agent USDC vaults") but a signal risk during a fundraise.
**Current state.** Unreviewed.
**Desired state.** A defensible name, accurate disclaimers, and an explicit decision to keep, separate, or shelve the token.
**Reasoning.** Cheaper before a public launch and a funding round than after.
**Dependencies.** P0-T3.
**Complexity.** S (engineering) · **Priority.** High

---

## STRETCH / POST-LAUNCH

| ID | Item | Complexity | Priority |
|---|---|---|---|
| S-1 | Agent credit / underwriting from spend history — the natural extension of owning the ledger | XL | Future |
| S-2 | Cross-org agent settlement network | XL | Future |
| S-3 | Programmable revenue share for agents that earn | L | Future |
| S-4 | Insurance / bonding against agent misbehaviour | XL | Future |
| S-5 | Regulatory licensing (MTL or partner bank) if custody stays in-house | XL | Future |
| S-6 | Anomaly detection with learned baselines rather than heuristics | L | Future |
| S-7 | Policy template marketplace by vertical | M | Future |
| S-8 | Agent-to-agent commerce built on the existing, under-exploited escrow primitive | L | Future |
| S-9 | Natural-language policy authoring ("agents may not pay anyone new after 6pm") | M | Future |
| S-10 | Multi-region deployment and data residency | L | Future |

---

# 3. IMPLEMENTATION ORDER — AND WHY

## The sequence

```
P0 ─► P1 ─► P2 ─┬─► P3 ─┬─► P4 ─► P5 ─┬─► P7 ─┐
                │       │             │       ├─► P9 ─► P12
                └─► P6 ─┘             └─► P8 ─┤
                                              └─► P10 ─► P11 ─┘
```

**P0 first (days).** Claim correction costs hours and is the highest-leverage work in the plan. CI and a working test harness must exist before anything modifies the money path.

**P1 second (days).** An unauthenticated wipe endpoint and a fund-destroying button are unacceptable during any subsequent phase. Containment is cheap; the exposure is not.

**P2 third, and it is the pivot.** Every downstream phase writes to persistence. Building Phase 3 identity, Phase 6 policy, or Phase 7 reconciliation on a store that silently discards writes means building it twice — and worse, testing it against semantics that will change. P2 also resolves eight findings on its own and revives three shipped-but-dead features. **Nothing substantive should be built before it.**

**P3 and P6 can run in parallel after P2.** Identity (P3) and policy scoping (P6) touch different subsystems and share only the database migration. If there is a second developer, this is the fork.

**P4 before P5.** Correcting settlement (P5) while keys are plaintext hot EOAs means solving nonce management and gas twice — once locally, once when the provider takes over. Adopting custody first lets P5 build on the provider's sequencing.

**P7 after P5.** Reconciliation is only meaningful once settlement is durable and simulated spend is marked. Reconciling against a ledger containing minted balance and mock payments produces noise, and noisy alarms get ignored.

**P8 after P6.** Agent hierarchy is what Phase 6 policy layers onto. Consolidating it first avoids a second migration.

**P9 after the data model settles.** Rebuilding onboarding before identity exists, or IA before per-agent policy surfaces exist, is rework. The one exception: P9-T2 (styling consolidation) is safe early and makes every later UI task cheaper — consider pulling it forward if there is frontend capacity during P2.

**P10 after P0-T3.** Publishing an SDK before the naming decision means the first breaking change is a rename. Do not publish twice.

**P11 last before launch** because compliance controls audit a system that has stopped changing shape. Two exceptions that must start early: **P11-T2 (KYB/Travel Rule) requires legal input on a long lead time** and should be scoped during Phase 4, since its answer may change the custody strategy. **P11-T6 (SOC 2)** should begin evidence collection as soon as CI exists.

**P12 gates the launch.** Observability, incident response, and load testing are the last things built and the first things needed.

## Two ordering decisions worth defending

**Why Phase 2 before Phase 3, when "no authentication" sounds more urgent than "storage is a cache".** Because the auth system is a large body of new persistent state — users, sessions, memberships, invitations, MFA enrolments. Building it on the Runtime Cache model means those writes are subject to the same lost-update defect, which for a session store is a *worse* failure than for a ledger: users randomly signed out, invitations silently vanishing, MFA enrolments lost. Fix the substrate, then build on it.

**Why claims correction (P0-T2) outranks every technical fix.** Every other finding is a normal engineering problem that a competent team fixes on a schedule. The claim gap is the only finding that changes how a reader interprets *all the others*. It is also the only one that is free.

---

# 4. RISK ASSESSMENT

## Technical

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Phase 2 migration corrupts or loses existing data** | Medium | High | Treat existing Runtime Cache data as expendable demo data — it already is. Do not build a migration; start clean with a documented cut-over and an explicit customer notice. |
| **Postgres migration silently changes transaction semantics** | Medium | High | Land P2-T5 (money-path tests) *before* P2-T2. Run both stores against the same suite during transition. |
| **Custody provider (P4-T1) does not fit the `CustodyProvider` interface** | Medium | High | Spike CDP Server Wallets in week one of Phase 4 with a throwaway branch. Keep Privy and Turnkey as evaluated alternatives, not hypothetical ones. |
| **x402 spec drift against a hand-rolled client** | Medium | Medium | Adopt the official packages in P5-T2 rather than maintaining a parallel implementation. Pin and monitor the spec version. |
| **Settlement state machine (P5-T3) has its own edge cases** | High | High | Property-based and fault-injection tests (P12-T4). Every state transition idempotent and replayable from chain state. |
| **RPC provider rate limits or outages** | High | Medium | Paid RPC with failover; the existing `eth_getLogs` chunking (commit `794c3b8`) shows the team already hit this. |

## Architectural

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Serverless convenience pulls the API back into Next** | Medium | Critical | Document the decision as an ADR with the failure analysis from this audit. Add a CI check that fails if the embed path is reintroduced. |
| **Tenant isolation regresses via a missed call-site check** | Medium | Critical | P2-T4 makes it structural. Add a test that asserts cross-org access returns 404 for every resource type. |
| **Policy layering (P6-T1) makes decisions unexplainable** | Medium | High | Provenance on every resolved rule from day one; the explain view is part of the feature, not a follow-up. |
| **`store.ts` boundary erodes under Postgres-specific optimisation** | Medium | Medium | Keep the SQLite implementation alive as the test store — it forces the boundary to stay honest. |

## UX

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Adding real auth makes onboarding slower and hurts demo conversion** | High | Medium | Keep a genuine sandbox mode: instant, isolated, clearly labelled, non-destructive. This preserves the current demo's strength without the current demo's danger. |
| **Per-agent policy (P6) overwhelms the policy UI** | High | Medium | Progressive disclosure — org defaults visible, overrides opt-in, with a resolved-effective-policy view per agent. |
| **The design system consolidation (P9-T2) visibly degrades the UI mid-flight** | Medium | Medium | Screenshot regression tests before starting; migrate view by view, not globally. |
| **Removing the fake deposit makes the product feel empty to evaluators** | High | Medium | Sandbox mode with clearly-marked simulated money replaces it — same demo value, no false belief. |

## Security

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **The public deployment is exploited before Phase 1 lands** | Medium | Critical | P1-T2 today: gate or take down. This is hours of work. |
| **New auth system introduces its own vulnerabilities** | Medium | Critical | Use a maintained provider (Auth.js/WorkOS); do not hand-roll sessions, password hashing, or MFA. |
| **Key migration (P4-T1) exposes keys in transit or logs** | Low | Critical | Migrate inside the signing boundary; assert no key material is ever logged or serialised; scrub logs in CI. |
| **Compliance screening fails open under vendor outage** | Medium | High | `ABI_COMPLIANCE_FAIL_CLOSED` becomes the default, not an option. Queue and retry rather than allow. |
| **Prompt injection through `remember_fact` persists into the system prompt** | Low | Medium | Sanitise and length-bound stored memories; keep the LLM strictly read-only (it currently is — preserve that invariant explicitly in tests). |

## Product

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **R1 Credibility** — the claim gap is discovered externally before it is fixed | **High** | **Critical** | P0-T2 this week. Then over-correct: publish a public, honest "what is and is not built" page. Nothing rebuilds trust faster than volunteering the gap. |
| **R2 Thin moat** — Coinbase, Privy, Turnkey, Crossmint, Skyfire converge on this space | High | High | Market the differentiators that actually exist: the **policy replay simulator** and **approval-with-re-evaluation**. Both are genuinely uncommon and both are under-marketed relative to "AI agent wallet", which is the crowded framing. |
| **R3 Wrong layer** — custody is high-cost, high-regulation, low-differentiation | High | High | P4-T1 buys custody. Re-evaluate at the Phase 4 gate whether ABI should own it at all. |
| **R4 Regulatory** — custodying USDC is money transmission | High | Critical | P11-T2 with counsel, scoped during Phase 4. Consider non-custodial (P4-T4) as the strategic default. |
| **R5 Single-author, agent-generated code with no human review of the money path** | High | High | P0-T4 (CI), P2-T5 (tests), P11-T5 (pen test). Add a rule: money-path changes require review by a second person. |
| **R6 Naming** — "Artificial Banking Incorporated" invites regulator attention; the code still says PolicyVault | High | Medium | P0-T3 + P12-T5. |
| **R7 Token distraction** during a fundraise | Medium | Medium | P12-T5: keep, separate, or shelve — but decide explicitly and document it. |
| **Scope exhaustion** — 13 phases is a long runway for a small team | **High** | **High** | The Beta gate (end of P8) is the real milestone. Phases 9–12 can compress substantially against real design-partner feedback. Do not treat this document as a contract; treat it as a dependency graph. |

---

# 5. DEFINITION OF BETA READY

*Private beta = a small number of known design partners, on testnet or with small real balances, with direct support and explicit expectations.*

**Non-negotiable:**

- [ ] **P0-T2** — no unsupportable claims anywhere in product, docs, or marketing
- [ ] **P0-T4, P0-T5** — CI green on every PR; `npm test` works from a clean clone on all platforms
- [ ] **P1-T1** — no endpoint can destroy another tenant's data
- [ ] **P1-T3** — no single action causes irreversible fund loss
- [ ] **P1-T4, P1-T5, P1-T6** — no anonymous org creation, no fail-open authorization, no default secrets in production, no SSRF surface
- [ ] **P2-T1, P2-T2** — persistent service on a real database; no per-request serialization; writes durable under concurrency
- [ ] **P2-T3** — background jobs run reliably; subscriptions actually charge; escrow and approval expiry fire on schedule
- [ ] **P2-T4** — tenant scoping enforced structurally
- [ ] **P2-T5** — money-path integration tests covering every guarantee the README claims
- [ ] **P3-T1, P3-T2** — real accounts; no credentials in browser storage; audit records name verified users
- [ ] **P3-T5** — account recovery exists
- [ ] **P4-T1** — no plaintext private keys; custody through a managed provider (**or** P4-T2 + a documented, time-boxed exception)
- [ ] **P5-T1, P5-T3** — correct signing domain; no settlement path that can leave money unrecorded
- [ ] **P6-T1** — per-agent policy enforced; org-level aggregate cap exists
- [ ] **P7-T1** — no unbacked ledger balance in a production org; on-chain reconciliation running with alerts
- [ ] **P12-T1** — money-affecting failures alert a human

**Strongly expected:**

- [ ] P5-T2 — at least one verifiable real x402 settlement
- [ ] P5-T4 — transaction queue with nonce sequencing
- [ ] P5-T5 — simulated spend visibly marked
- [ ] P8-T2 — per-tenant control over LLM data egress
- [ ] P10-T1, P10-T5 — published TS SDK; one-command local stack
- [ ] P3-T3 — step-up auth on high-value approvals

**Explicitly deferred past beta:** SSO/SCIM, SOC 2, KYB, billing, mobile push, multi-chain, Python SDK (unless a design partner is Python-first — in which case P10-T2 moves into this list).

**Beta exit criteria:** three design partners running real agent workloads for four weeks with zero unexplained ledger discrepancies, zero unrecorded on-chain movements, and zero P1 incidents.

---

# 6. DEFINITION OF PUBLIC LAUNCH READY

*Public launch = self-service sign-up, real funds, no hand-holding, public scrutiny.*

**Everything in Beta Ready, plus:**

**Security & compliance**
- [ ] **P11-T5** — third-party penetration test passed, findings remediated and re-tested
- [ ] **P11-T1** — real sanctions/KYT screening, failing closed
- [ ] **P11-T2** — KYB onboarding; Travel Rule where applicable; counsel sign-off on custody posture
- [ ] **P11-T3** — SSO/SAML available
- [ ] **P11-T4** — tamper-evident audit log; retention and deletion policies; data-residency answer
- [ ] **P11-T6** — SOC 2 Type I in progress or achieved
- [ ] **P3-T3, P3-T4** — step-up auth and a real role model

**Reliability**
- [ ] **P12-T1, P12-T2** — full observability, on-call, runbooks, status page, stated SLA
- [ ] **P12-T4** — load and chaos testing passed, results documented
- [ ] **P5-T3, P5-T4** — settlement proven durable under fault injection
- [ ] **P4-T3** — gas managed automatically; no customer-visible gas failures

**Product**
- [ ] **P6-T1, P6-T2** — every policy control behaves as labelled
- [ ] **P7-T1, P7-T2** — one real funding path; reconciliation clean
- [ ] **P9-T1** — self-service onboarding, time-to-first-payment under five minutes
- [ ] **P9-T3** — WCAG 2.1 AA, verified
- [ ] **P8-T3** — no shipped feature that silently does nothing
- [ ] **P9-T6** — mobile approvals work, or the surface is removed

**Developer experience**
- [ ] **P10-T1, P10-T2** — TS **and** Python SDKs published
- [ ] **P10-T3** — developer portal with runnable quickstarts
- [ ] **P10-T4** — self-service credential management
- [ ] **P8-T4** — at least two framework adapters shipped

**Business**
- [ ] **P12-T3** — billing and metering live
- [ ] **P12-T5** — legal review of name, disclaimers, terms; explicit token decision
- [ ] **P0-T3, P0-T6** — one brand, one authoritative doc set

**Hard gate:** ABI must be able to state, with evidence, that **no customer has ever had an on-chain movement absent from their ledger, and no ledger entry exists without a corresponding real-world event.** If that sentence cannot be said with confidence, launch is premature regardless of the checklist.

---

# 7. FINDING → TASK TRACEABILITY

Every audit finding, mapped. Nothing dropped.

| Finding | Task |
|---|---|
| C1 anonymous destructive bootstrap | P1-T1 |
| C2 Runtime Cache persistence | P2-T1, P2-T2 |
| C3 no CDP integration | P0-T2 (disclosure), P4-T1 (build) |
| C4 plaintext vault keys | P4-T1, P4-T2 |
| C5 rotate-vault destroys funds | P1-T3, P4-T1 |
| C6 60s limit vs 120s receipt | P2-T1, P5-T3 |
| C7 no authentication system | P3-T1, P3-T2 |
| H1 no per-agent policy | P6-T1 |
| H2 no org aggregate cap | P6-T1 |
| H3 deposit mints unbacked money | P7-T1, P7-T2 |
| H4 no on-chain reconciliation | P7-T1 |
| H5 mock rail books as real | P5-T5 |
| H6 no nonce management | P4-T1, P5-T4 |
| H7 no gas management | P4-T3 |
| H8 rate limit keyed on attacker input | P1-T4 |
| H9 fabricated `security.mjs` claim | P0-T2, P2-T5 |
| M1 webhook retries dead in prod | P2-T1, P2-T3 |
| M2 x402 closed loop | P5-T2 |
| M3 compliance is an env var | P11-T1 |
| M4 org data → OpenAI, no control | P8-T2 |
| M5 empty scopes fail open | P1-T5 |
| M6 SSRF via `localhost` template | P1-T6 |
| M7 cooldown is not a cooldown | P6-T2 |
| M8 quiet hours UTC-only | P6-T2 |
| M9 no step-up auth; free-text `resolvedBy` | P3-T1, P3-T3 |
| M10 policy version attribution on restore | P6-T2 |
| L1 anonymous org creation | P1-T4, P3-T1 |
| L2 hardcoded default pepper | P1-T5 |
| L3 plaintext secret fallback | P1-T5 |
| L4 escrow refund doesn't restore cap | P6-T2 |
| L5 47 untyped buttons | P9-T3 |
| L6 stress-probe unbound | P0-T7, P12-T4 |
| L7 `X402Error` union incomplete | P0-T7 |
| No CI | P0-T4 |
| Root `npm test` broken | P0-T5 |
| Web tests excluded | P0-T5 |
| Inverted test coverage | P2-T5 |
| 100% CSR, 320 kB bundle, 14-endpoint polling | P9-T4 |
| Three styling systems, two icon sets | P9-T2 |
| Oversized views (1,074 / 1,506 / 1,429 lines) | P9-T4 |
| Orphaned `apps/mobile` | P0-T1, P9-T6 |
| 13-line `apps/worker` | P2-T3 |
| Unwired `packages/db` | P0-T1, P2-T2 |
| PolicyVault ⇄ ABI split | P0-T3 |
| Docs stale, duplicated, foreign absolute paths | P0-T6 |
| 4.2s blocking intro | P9-T1 |
| Paste-a-token onboarding | P9-T1 |
| Two contradictory funding paths | P7-T2 |
| Nav/IA growth pressure | P9-T5 |
| Accessibility partial | P9-T3 |
| External-actions no-op stub | P8-T3 |
| No wallet connection | P4-T4 |
| No published SDK | P10-T1 |
| No Python SDK | P10-T2 |
| No framework adapters | P8-T4 |
| No developer portal | P10-T3 |
| No credential management UI | P10-T4 |
| No local dev story | P10-T5 |
| No billing/metering | P12-T3 |
| No status page / SLA / incidents | P12-T2 |
| Multi-chain / multi-asset | P7-T3 |
| Spend categories, counterparty risk | P6-T3 |
| Time-boxed budgets | P6-T4 |
| KYB, Travel Rule | P11-T2 |
| SSO/SAML/SCIM | P11-T3 |
| Audit-log integrity, retention, GDPR | P11-T4 |
| SOC 2 path | P11-T6 |
| Mobile push | P9-T6 |
| R1 credibility | P0-T2 |
| R2 thin moat | Risk §4 (positioning) |
| R3 wrong layer | P4-T1 + Phase 4 gate review |
| R4 regulatory | P11-T2, P12-T5 |
| R5 no human review of money path | P0-T4, P2-T5, P11-T5 |
| R6 naming | P0-T3, P12-T5 |
| R7 token distraction | P12-T5 |

---

**Awaiting approval.** On approval I will start with **Phase 0**, beginning with P0-T2 (claim correction) and P0-T5 (test harness) — the two smallest changes with the largest downstream effect — and stop for review before Phase 1.
