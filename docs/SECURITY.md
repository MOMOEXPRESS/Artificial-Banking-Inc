# Security

> **This document states the posture as it actually is, not as we intend it to
> be.** Where a control is missing, it says so and links to the roadmap task
> that adds it. Nothing here is aspirational.

## Reporting a vulnerability

Email the maintainer listed on the repository, or open a private security
advisory on GitHub. Please do not open a public issue for an exploitable defect.

We aim to acknowledge within 72 hours. There is currently **no bug bounty**.

---

## Current posture — read this before deploying

ABI is **pre-beta**. It has not been penetration tested, has no compliance
certification, and carries known critical defects documented in
[`docs/archive/2026-07-26-independent-audit.md`](./archive/2026-07-26-independent-audit.md).

**Do not run this against real customer funds.** The remediation sequence is
[Phases 1–4 of the roadmap](./ROADMAP.md).

| Area | Status | Roadmap |
|------|--------|---------|
| **Authentication** | ⚠️ **Mostly there.** Accounts, scrypt passwords, httpOnly sessions with CSRF, memberships, invitations, TOTP second factor with recovery codes, step-up on high-value approvals, and password reset. Bearer keys remain for machine access. Still missing: SSO/SAML, email verification, and an email provider (reset links are logged, not delivered). | P3-T1 ✓, P3-T2 ✓, P3-T3 ✓, P3-T5 ◐, P11-T3 |
| **Custody** | ⚠️ **Self-custody, encrypted at rest.** Vault keys are AES-256-GCM encrypted under `ABI_KEK`, bound to their org. Still not CDP, an HSM, or MPC: whoever holds both the database *and* this process's environment gets the keys. Managed custody is the real fix. | P4-T2 ✓, P4-T1 |
| **Persistence** | ✅ Fixed. The API is a persistent process with real transactions; the embedded serverless runtime and its runtime-cache database sync are gone. Postgres (horizontal scale) is still ahead. | P2-T1 ✓, P2-T2 |
| **Destructive endpoints** | ✅ Fixed. Demo seeding no longer deletes anything; the global wipe is a local script (`npm run db:reset`) and is unreachable over HTTP. | P1-T1 |
| **Compliance screening** | ⚠️ Environment-variable denylist only. No OFAC, sanctions, or KYT data source. | P11-T1 |
| **Rate limiting** | ✅ Fixed. Keyed on the hash of the presented credential (or source IP), with a bounded window map and a tighter per-IP budget on credential-minting routes. | P1-T4 |
| **LLM data egress** | ⚠️ When `OPENAI_API_KEY` is set, org balances, agent names and spend figures are sent to OpenAI. No per-tenant opt-out. | P8-T2 |
| **Penetration test** | ❌ Never performed. | P11-T5 |
| **SOC 2 / SSO / SCIM** | ❌ None. | P11-T3, P11-T6 |

---

## What *is* enforced today

These are real, implemented, and worth knowing about. File references are given
so each can be verified rather than taken on trust.

**Deterministic authorization.** The LLM never authorizes spend. It emits a
structured intent; `evaluatePolicy` decides. Default deny; every decision
carries rule IDs and human-readable reasons.
→ `packages/policy/src/index.ts`

**Limits are per agent, and there is a ceiling on the whole organization.**
Policy resolves in layers — organization defaults, then an optional per-agent
override — and every decision can say which layer supplied each value. There
was previously one policy row per org, so a research bot and a payments bot
were necessarily under identical limits, and twenty agents each under a "$50
daily max" could spend $1,000/day with nothing to stop them.
→ `packages/policy/src/index.ts` (`resolvePolicy`), `apps/api/src/engine.ts` (`rulesFor`)

**Controls behave as their labels claim.** The new-counterparty cooldown now
uses its own hours setting instead of treating any nonzero value as a boolean,
and quiet hours are evaluated in the organization's timezone rather than always
UTC — an APAC team setting 22:00–06:00 previously got a block in the middle of
their working day.

**Allowlists that fail closed.** An empty allowlist never votes "allow" — with
OR-combined lists that would silently disable every other list. Domain suffix
matching is dot-anchored, so `api.openai.com.attacker.net` cannot masquerade as
`api.openai.com`. Bare TLD entries never widen a match.
→ `packages/policy/src/index.ts` (allowlist matching)

**Idempotency reserved before execution.** The key is claimed *before* the rail
runs, not checked-then-written. Two concurrent retries of the same payment
settle exactly once. Denials replay as denials, not as HTTP 200.
→ `apps/api/src/index.ts` (`handleIntent`)

**Approvals re-run policy at execution time.** A guardian's approval satisfies
the human-in-the-loop rule; it does not waive caps, freezes, or the blocklist.
Between parking and approving, the agent may have been frozen or the cap
consumed — so a queue of individually-legal approvals cannot collectively blow
the daily limit.
→ `apps/api/src/engine.ts` (`resolveApproval`)

**Atomic claims on money-moving state.** Approvals and escrows are claimed by
compare-and-swap before the ledger is touched, so two guardians pressing
Approve simultaneously execute once.
→ `apps/api/src/engine.ts` (`resolveApproval`, `settleEscrow`)

**Quorum counts authenticated identities**, never the client-supplied
`resolvedBy` label — otherwise one guardian could satisfy a 2-of-N quorum alone
by voting twice under different names.
→ `apps/api/src/engine.ts`

**The x402 rail validates everything the seller controls before signing.** Token
contract pinned per network, `payTo` format- and blocklist-checked, price
sanity-checked against the authorized ceiling, and the authorization validity
window clamped regardless of what the seller asks for.
→ `apps/api/src/rails/x402.ts`

**Balanced double-entry ledger.** Every journal must sum to zero; asset accounts
cannot go negative; a cross-tenant guard sits inside the ledger itself, not just
at the call site.
→ `packages/ledger/src/index.ts`

**Tenant isolation.** The organization is always derived from the bearer key,
never from a request parameter or body.
→ `apps/api/src/index.ts` (`authGuardianCtx`, `guardianRoute`)

**One outbound-URL guard, applied everywhere.** A denylist covering private
ranges, IPv6, CGNAT, cloud metadata endpoints and embedded credentials now
protects webhook delivery *and* the x402 rail, which previously fetched
agent-supplied URLs unchecked. Cloud metadata is refused even in development.
Webhooks are additionally HMAC-SHA256 signed over the raw body, with a
rotatable secret shown once and a delivery ID for receiver-side dedupe;
the URL is re-checked immediately before each attempt and redirects are refused.
→ `apps/api/src/outbound-url.ts`, `apps/api/src/webhooks.ts`, `apps/api/src/rails/x402.ts`

**Human identity, not a shared string.** Users sign in with email and password
(scrypt, per-user salt, parameters stored with the hash). The console credential
is an httpOnly cookie the browser holds — JavaScript cannot read it, it expires,
and it can be revoked server-side. Changing a password revokes every session,
including the one that changed it. Login answers identically for a wrong
password and an unknown account, so the form is not an account-existence oracle.
Roles come from a per-organization membership row, so the same person can hold
different roles in different orgs.
→ `apps/api/src/auth/`, `apps/api/src/routes/auth-routes.ts`

**Signatures are computed over the token's real domain.** The EIP-712 domain
is resolved per network from a table verified against the deployed contracts —
Base mainnet USDC is named "USD Coin", Base Sepolia's is named "USDC". The
client previously hardcoded the mainnet name for both, so every testnet
signature recovered to the wrong address; the bundled facilitator shared the
same constant and agreed with it, which is why the demo passed and real
settlement never could. An unknown token is refused rather than guessed.
→ `apps/api/src/chain/token-domain.ts`

**No settlement is invisible.** Every payment writes a durable attempt row
*before* the rail is invoked, and the transaction hash is persisted the moment
it exists — before waiting for confirmation, because that is the window in
which money has already moved. A crash or timeout there used to leave no trace
at all. A recovery job resolves anything left mid-flight from chain evidence,
or escalates it to a human; it never re-applies ledger entries on its own,
because booking a payment from a background job on after-the-fact evidence is
how a recovery path becomes a double-spend.
→ `apps/api/src/jobs/settlement-recovery.ts`

**Vault keys are encrypted at rest.** AES-256-GCM under `ABI_KEK`, fresh IV per
encryption, with the organization id as authenticated data — so a ciphertext
cannot be moved from one org's row to another's. A tampered or wrongly-keyed
value throws rather than returning garbage, because signing with a silently
corrupted key is worse than refusing. Databases written before this are
upgraded in place at boot. Production refuses to start without `ABI_KEK`.
→ `apps/api/src/auth/key-encryption.ts`

**Outbound transactions are serialised per vault.** Concurrent payments from one
organization previously read the same nonce, so one transaction silently
replaced the other while the ledger recorded both. Multi-agent concurrency is
this product's entire premise, so that was the common path. Note the queue is
per-process: running more than one API instance needs a database-backed queue
or a custody provider that sequences.
→ `apps/api/src/chain/vault-queue.ts`

**Gas is monitored, not discovered.** An hourly job warns before a vault runs
out of native token, instead of surfacing `INSUFFICIENT_GAS` mid-payment.
→ `apps/api/src/jobs/gas-monitor.ts`

**Second factor, and step-up where it matters.** TOTP (RFC 6238) implemented on
node:crypto, with single-use recovery codes so a lost phone is not a lost
organization. A code cannot be replayed inside its own 30-second window.
Approvals at or above `ABI_STEP_UP_ABOVE_USDC` (default $100) require a fresh
re-authentication — possession of a live session is not enough to move real
money. Denials are never gated: making it harder to *stop* money is the wrong
asymmetry.
→ `apps/api/src/auth/totp.ts`, `apps/api/src/routes/mfa-routes.ts`

**Password recovery that evicts the intruder.** Reset tokens are hashed,
single-use and expire in an hour; issuing a new one invalidates the old. A
completed reset revokes every session, so whoever prompted it loses access. The
request endpoint always answers 200, so it cannot be used to enumerate accounts.

**CSRF on cookie-authenticated mutations.** Cookies ride along on cross-site
requests, so mutations require a double-submit token the attacking origin cannot
read. Bearer callers are exempt — nothing attaches those headers on their behalf.
→ `apps/api/src/auth/session.ts`

**Scope resolution fails closed.** A session key whose stored scope list is
empty or malformed grants nothing. It used to default back to
`["read","pay","escrow"]` — full money authority — on exactly that input.
→ `apps/api/src/store.ts` (`getSessionByToken`)

**Demo seeding cannot destroy a tenant.** Seeding creates a new organization and
touches nothing existing. The global wipe is a local script and is not routable.
→ `apps/api/src/store.ts` (`seedDemoOrg`, `resetAllData`)

**Vault rotation preserves recoverability.** Rotation refuses while the vault
holds USDC or native balance (or while that balance cannot be read), and the
retired key is archived rather than overwritten.
→ `apps/api/src/store.ts` (`rotateVaultKey`), `apps/api/src/routes/treasury-routes.ts`

**API keys hashed at rest.** Bearer secrets are stored as
`h1:sha256(pepper || secret)` and revealed exactly once on create/rotate.
Note this covers API keys — **not** vault private keys.
→ `apps/api/src/secrets.ts`

---

## Verifying these claims

Run the suite:

```bash
npm test
```

Tested today: the policy engine, the ledger, the outbound-URL guard, secret
hashing and its production fail-closed paths, session-scope resolution, and the
non-destructiveness of demo seeding.

Also tested now: the execution engine (hold / settle / partial release),
approval resolution including quorum, RBAC and the re-evaluation that stops a
queue of approvals blowing the daily cap, escrow compare-and-swap, HTTP-level
idempotency under concurrent retries, and background-job leasing.

Still uncovered: the x402 rail's network dance and the on-chain transfer rail,
both of which need a chain fixture.

## Hardening a deployment

Required before exposing any instance:

```bash
NODE_ENV=production
ABI_KEY_PEPPER=<32+ random bytes>      # REQUIRED — production refuses to boot without it
ABI_SIGNUP_TOKEN=<random>              # REQUIRED for self-serve org creation
POLICYVAULT_ALLOW_BOOTSTRAP=0          # no demo seeding on a real deployment
POLICYVAULT_ALLOW_PUBLIC_ORG_CREATE=0  # invite-only org creation
ABI_ALLOW_LOCAL_TARGETS=0              # refuse outbound fetches to private addresses
ABI_COMPLIANCE_FAIL_CLOSED=1           # block on screener failure
```

Even with all of the above set, the deployment remains self-custodied with
unencrypted vault keys and no authentication system. Treat it as a demo.
