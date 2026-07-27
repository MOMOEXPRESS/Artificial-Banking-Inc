# Owner actions — what only you can do

**Written:** 2026-07-27 · **Against:** `main` @ `b030b09` (Phase 7 + Phase 6 deferrals complete)

Everything in this file is blocked on something I do not have: money, a legal
identity, an account under your name, a browser, or a decision that is yours to
make. Nothing here is work I can finish and have chosen not to.

Ordered by what unblocks the most. Each item says **why it is blocked on you**,
so you can hand any of it to someone else without re-deriving the context.

---

## 0. Read first: the verification debt

You asked me to keep building and batch verification later. That debt is real
and it is concentrated in the money path. Phases 5, 6 and 7 are **green in unit
tests and have never touched a real chain or a real browser.**

Specifically, none of the following has ever executed against reality:

| Never run | Where | Risk if wrong |
|---|---|---|
| A real USDC transfer out of a vault | `chain/transfer.ts`, treasury withdraw | Money leaves, or does not, incorrectly |
| An on-chain balance read for reconciliation | `treasury-backing.ts` | Drift alarm silent or crying wolf |
| A per-asset ERC-20 balance read | `chain/asset-adapters.ts` | Holdings display wrong |
| An x402 settlement against a real facilitator | `rails/x402.ts` | The headline integration may not work |
| Any console screen built in Phases 6–7 | Treasury Fund, Policy → Budgets | Layout or wiring broken |

Section 2 is how you clear it. **I would not demo the treasury to anyone
outside the company until section 2 is done.**

---

## 1. Secrets and accounts I cannot create

### 1.1 Generate and back up `ABI_KEK` — before any real funds

Vault private keys are encrypted at rest under this key. The API refuses to
boot in production without it (`apps/api/src/auth/key-encryption.ts:38`).

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

**Blocked on you:** it must never exist in a repo, a chat log, or my context.
Store it in a password manager and a second offline location.

> **If you lose this, every vault key is unrecoverable and every vault is
> permanently unspendable.** There is no reset path. This is the single most
> important line in this document.

### 1.2 Generate `ABI_KEY_PEPPER` and `ABI_SIGNUP_TOKEN`

Same method, same storage. The pepper hashes API keys; the signup token gates
credential-minting routes and is mandatory in production.

### 1.3 A paid RPC endpoint

Public Base RPC endpoints rate-limit and drop `eth_getLogs` ranges under load —
the team already hit this once (commit `794c3b8`). Deposit detection and
reconciliation both read the chain on a timer, so this degrades quietly.

- Sign up: Alchemy, Infura, QuickNode, or Coinbase Node
- Set `CHAIN_RPC_URL` (Base / Base Sepolia)
- Set `ETHEREUM_RPC_URL` **only** if you want mainnet ERC-20 holdings read;
  I deliberately shipped no default for it, because a failing public mainnet
  endpoint produces readings that look like drift

**Blocked on you:** billing account.

### 1.4 Optional notification channels

| Channel | Variables | Notes |
|---|---|---|
| Telegram | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_ALLOWED_USER_IDS` | Create via @BotFather |
| Slack | `SLACK_WEBHOOK_URL` | For drift and approval alerts |
| Email | `RESEND_API_KEY`, `ABI_NOTIFY_EMAIL_TO/FROM` | Resend account + verified domain |

Until at least one is set, **a treasury drift alarm reaches the in-app Chat
view and the process logs, and nothing else.** If nobody is looking at the
console, nobody is told.

---

## 2. Clearing the verification debt

This needs a funded testnet vault and about an hour. It is the highest-value
thing on this list.

### 2.1 Fund a Base Sepolia vault

1. Start the stack, create an org, open **Treasury → Fund**, copy the vault address
2. Get testnet USDC: <https://faucet.circle.com> (select Base Sepolia)
3. Get testnet ETH for gas: <https://www.alchemy.com/faucets/base-sepolia>
   — without ETH every outbound transfer fails with `INSUFFICIENT_GAS`

**Blocked on you:** faucets require a wallet, and some require a funded mainnet
account or social login.

### 2.2 Then verify, in this order

| # | Check | Pass looks like |
|---|---|---|
| 1 | Deposit auto-credit | USDC arrives → ledger balance rises within ~30s with no manual sync |
| 2 | Backing panel | Treasury → Fund shows "Books match the chain" |
| 3 | **Drift detection** | Send USDC *out* of the vault from an external wallet → panel flips to "Drift −$X" within 5 min, and a notification fires |
| 4 | Live withdrawal | Treasury → Send to a 0x address → real tx hash, balance drops, books still match |
| 5 | Deposit refusal | Confirm a live org has **no** manual receive control at all |
| 6 | Agent pay | Playground → on-chain wallet pay → real tx on Basescan |
| 7 | Policy → Budgets | Set a category cap and a budget window; confirm a payment is refused with the right reason |

Check 3 is the one I care most about — it is the only end-to-end proof that the
reconciliation built in Phase 7 actually detects anything.

**Report back:** anything that fails here, with the console error and the API
log line. Failures in 3, 4 or 6 mean real bugs in code that currently looks
green.

### 2.3 A browser I can drive

The preview tool in my session starts a dev server that dies immediately and
then refuses navigation, so I have shipped console UI I have never seen
rendered. If you can get the preview pane working, or run the app and paste
screenshots, I can close the UI half of this debt myself.

---

## 3. Decisions that are yours, not mine

I have made a defensible default for each. Each is reversible; none should be
mine permanently.

### 3.1 Existing orgs were migrated to `sandbox`

Phase 7 defaults every pre-existing org to sandbox mode, because all of them
could mint unbacked balance under the old model. **If any org holds real money,
you must promote it** — otherwise its balances stay labelled simulated.

No console control exists yet. Deliberate: promoting an org to live is a claim
that its books are backed, and I did not want that to be a button someone
clicks past. Tell me how you want it gated and I will build it.

### 3.2 The mock rail still exists

Payments to non-address, non-URL destinations settle against `TransferMockRail`
and book as real spend, marked unbacked. It is what makes offline demos work.

**Decision:** keep it for sandbox orgs only, or delete it. I would keep it,
gated to sandbox.

### 3.3 Is the demo bootstrap endpoint still wanted?

`POST /v1/demo/bootstrap` is no longer destructive (it seeds a *new* org and
leaves others alone) and is gated behind `POLICYVAULT_ALLOW_BOOTSTRAP` plus the
signup token. The roadmap's P1-T1 called for deleting it entirely.

**Decision:** keep it as gated demo seeding, or remove it.

### 3.4 Custody strategy — the biggest open question

There is still no Coinbase integration. `SelfCustodyVaultProvider` holds the
key in the API process, encrypted at rest.

Three paths, and this one has legal consequences (§4.1):

1. **Managed custody** (CDP Server Wallets / Privy / Turnkey) — P4-T1 as written
2. **Non-custodial** — customers connect their own wallet; ABI never holds keys
3. **Status quo** — self-custody, which is the highest-liability option

I lean 2 for the regulatory reason in §4.1, but this is a founder call. Pick
one before I build further into custody.

---

## 4. Legal, regulatory and financial

I can implement controls. I cannot give legal advice or sign anything.

### 4.1 Counsel on money transmission — start early, long lead time

Custodying customer USDC in the US is likely money transmission, requiring
state MTLs or a partner bank. `LEGAL_FOOTER` is a good instinct and not a
defence.

**Ask counsel:** does §3.4 option 2 (non-custodial) materially reduce this? The
answer changes the architecture, so get it before Phase 4 restarts.

### 4.2 The company name

"Artificial Banking Incorporated" invites banking-regulator attention for a
product that is explicitly not a bank. Cheaper to review now than after a
funding round.

### 4.3 KYB / Travel Rule (P11-T2)

Blocked on both counsel and a vendor account (Persona, Sumsub, or similar).

### 4.4 Sanctions screening (P11-T1)

`ComplianceScreener` is a well-built seam with an env-var denylist behind it.
Real screening needs a Chainalysis or TRM contract — **blocked on your
procurement**, and blocking for mainnet with third-party funds.

### 4.5 The token

`contracts/AbincToken.sol` and the pump.fun references in `docs/LAUNCH.md` sit
beside an unfinished financial product. Correctly firewalled in code, but a
signal risk during a raise.

**Decision:** keep, separate into another entity, or shelve. Document whichever.

---

## 5. Infrastructure and hosting

### 5.1 Take the public deployment down or gate it (P1-T2)

If any deployment is still publicly reachable, gate it now. It predates every
Phase 1–7 fix.

**Blocked on you:** Vercel account access.

### 5.2 Postgres for production (P2-T2)

SQLite is a single-process ceiling. `packages/db` has a Prisma schema and
`store.ts` is a clean seam, but production needs a managed Postgres (Neon,
Supabase, RDS) — **blocked on your billing account.**

### 5.3 Hosting for the API and worker

The API is now a persistent process, not a serverless function. It needs
somewhere to run (Railway, Render, Fly, ECS) with `ABI_RUN_JOBS` set so exactly
one process owns the background sweeps.

### 5.4 Monitoring that pages a human (P12-T1)

`/metrics` is Prometheus-formatted and nothing consumes it. Money-affecting
failures — drift, stuck settlement, gas floor — need to reach a phone. Blocked
on a Grafana Cloud / Datadog / Betterstack account.

---

## 6. Third parties you must engage

| What | Why blocked on you | Roadmap |
|---|---|---|
| **Penetration test** | Contract + payment. The money path has had no independent human review, and nearly all of it is agent-authored. | P11-T5 |
| **SOC 2 auditor** | Contract. Start evidence collection early; the observation window is the long pole. | P11-T6 |
| **A second engineer to review money-path changes** | Hiring. Right now no human has independently reviewed the code that moves funds. | R5 |

The third is the one I would not skip. I write these changes and I also write
the tests that check them; that is not review.

---

## 7. Publishing and distribution

| Item | Blocked on |
|---|---|
| npm org for `@abi/sdk` (P10-T1) | Your npm account; name must be settled first |
| PyPI project for the Python SDK (P10-T2) | Your PyPI account |
| Docs domain + hosting (P10-T3) | DNS |
| GitHub org settings — branch protection, required CI | Repo admin |

Branch protection matters: CI exists (`.github/workflows/ci.yml`) but nothing
forces it to pass before merge.

---

## 8. Housekeeping from this session

- **Git identity was unset.** I set it repo-locally to
  `ABI dev <momomaurice20006@gmail.com>` to match the Phase 3–6 commits. Change
  it if that is wrong.
- **A stale branch is stashed.** `cursor-preview` sat six phases behind `main`
  and had uncommitted UI work plus a duplicate claim-correction pass. It is in
  `git stash` on that branch. Nothing there is worth keeping — drop it when
  convenient.
- **`docs/ROADMAP.md` still lists P6-T3, P6-T4 and P7-T3 as deferred.** They
  landed in `7582000`, `b030b09` and `fd29d1a`. Worth updating so the roadmap
  does not become the tenth document that disagrees with the others.

---

## The short version

If you only do three things:

1. **Generate and back up `ABI_KEK`** (§1.1) — everything else is recoverable
2. **Fund a testnet vault and run the seven checks** (§2) — that is the whole
   verification debt
3. **Decide custody** (§3.4) and get counsel started on §4.1 — the longest lead
   time on the list
