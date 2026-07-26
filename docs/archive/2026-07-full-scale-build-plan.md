# ABI / PolicyVault — Full-Scale Build Plan

> **Archived — point-in-time.** Written July 2026. Kept for history; it is not a
> description of the current system and is not maintained. The living documents
> are [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) and
> [`docs/ROADMAP.md`](../ROADMAP.md).

**Product:** Policy-gated USDC treasury & payments OS for AI agents  
**Company (optional):** Artificial Banking Inc (OpCo) — product brand ≠ “licensed bank”  
**Settlement:** Base + USDC  
**Rule:** LLM proposes; policy + signer authorize. Keys never in the model.

> This is the master engineering/product build document. Token and “bank” branding are **late phases**. MVP is non-custodial (or TEE-backed) agent treasuries with guardians, policy, escrow, and x402.

---

## 0. What we are building (one page)

| Question | Answer |
|----------|--------|
| **What we sell** | Safe agent money rails: budgets, caps, allowlists, escrow, receipts, kill switch |
| **Who pays us** | Human operators / orgs (SaaS + take-rate on escrow/settle) |
| **Who spends** | Agents, via SDK/MCP tools only |
| **What money is** | USDC in org vaults + agent stipends (not ABI token) |
| **Core loop** | Deposit → allocate → agent `pay_*` tool → policy → sign → ledger → task continues |

**Maya example (reference):** Client job $25 escrowed → Researcher/Writer/QA agents pay allowlisted APIs under caps → deliverable PDF → escrow release → P&L. Drain attempts blocked.

---

## 1. Architecture

### 1.1 Bounded contexts

1. **Identity** — Org, Guardian, Agent, API keys, (later KYA)
2. **Custody / Signer** — Smart accounts, session keys, TEE/MPC adapter
3. **Policy** — Rules eval, simulate, versions
4. **Ledger** — Double-entry, holds, reconciliation
5. **Commerce** — Escrow, invoice, jobs, splits
6. **Rails** — USDC transfers, x402 facilitate
7. **Runtime adapters** — MCP, HTTP SDK, Eliza/LangGraph plugins
8. **Guardian experience** — Web + Telegram/Slack approvals
9. **Audit / Ops** — Decision traces, freezes, support read-only
10. **Token (Phase 4+)** — Points → ABI utility (fees/bonds only)

### 1.2 Logical flow

```
Guardian UI / Telegram
        │
        ▼
   API Gateway (authz)
        │
   ┌────┴─────────────────────────────┐
   ▼                                  ▼
Policy Engine ◄── Intent (from Agent SDK/MCP)
   │ allow / deny / needs_approval
   ▼
Signer Service (TEE/AA) ──► Base (USDC / x402)
   │
   ▼
Ledger + Audit log ──► Webhooks ──► Agent runtime
```

### 1.3 Suggested services (MVP)

| Service | Responsibility |
|---------|----------------|
| `api-gateway` | Auth, rate limits, routing |
| `policy-engine` | Deterministic eval + simulate |
| `ledger-service` | Accounts, journals, holds |
| `custody-adapter` | CDP Agentic Wallet / ERC-4337 |
| `commerce-service` | Escrow, invoices, jobs |
| `rail-x402` | Pay / receive HTTP 402 |
| `notifier` | Telegram/Slack/email |
| `indexer-worker` | Chain events → reconcile |
| `webhook-dispatcher` | Signed at-least-once delivery |
| `web-guardian` | Next.js app |
| `sdk` + `mcp-server` | Agent surface |

### 1.4 Data stores

- **Postgres** — source of truth for ledger, policies, orgs (integer micro-USDC)
- **Redis** — sessions, rate limits, idempotency
- **Object store** — exports, deliverable hashes metadata
- **Append-only decision log** — WORM or hash-chained
- **Queue** — Temporal / BullMQ for UserOps, webhooks, reconcile

### 1.5 Tech stack (opinionated)

- Chain: **Base** (Sepolia → mainnet)
- Asset: **USDC** (6 decimals → store as integer micro-units)
- Accounts: **Coinbase Agentic Wallets** or ERC-4337 (ZeroDev/Biconomy) + paymaster
- API: TypeScript (Node) or Go for policy hot path
- Web: Next.js
- Contracts: Foundry (escrow, fee router later)
- Indexer: Goldsky or custom
- Observability: OpenTelemetry + metrics + status page

### 1.6 Consistency & money invariants

- **No floats** for money; micro-USDC integers only
- Every external side effect has **idempotency key**
- Ledger first (pending) → chain → finalize/compensate
- Daily **on-chain vs ledger reconciliation**; alert on drift > $1
- Policy **default deny**
- Tenant isolation on every query (RLS or hard `org_id` filter)

---

## 2. Core data model (entities)

| Entity | Key fields |
|--------|------------|
| `Org` | id, name, status, created_at |
| `Guardian` | id, org_id, auth, roles, telegram_id |
| `Agent` | id, org_id, name, status, runtime_meta |
| `Vault` | org_id, chain, address, custody_provider |
| `StipendAccount` | agent_id, available_usdc, held_usdc |
| `Policy` + `PolicyVersion` | dsl/source, compiled_ir, hash, semver |
| `AllowlistEntry` | type (address/domain/contract), value, cooldown |
| `Intent` | agent_id, job_id?, tool, amount, destination, idempotency_key |
| `Decision` | intent_id, outcome, rule_ids, facts_json, policy_version |
| `Approval` | decision_id, guardian_id, status, expires_at |
| `LedgerAccount` / `JournalEntry` | double-entry lines |
| `ChainTx` | hash, status, intent_id |
| `Escrow` | job_id, amount, state, timeout, parties |
| `Invoice` | payer, payee, amount, status |
| `Job` | org_id, brief, deliverable_hash, escrow_id |
| `ApiKey` | agent_id, scopes, hash, expires |
| `SessionKey` | smart_account, scope, ttl, revoked |
| `WebhookEndpoint` | url, secret, version |
| `FreezeEvent` | scope, reason, actor, at |
| `WebhookDelivery` | event_id, attempts, dlq |

---

## 3. Money & task state machines

### 3.1 Deposit
`external USDC → vault credited (after N confirmations) → available_org`

### 3.2 Allocate / reclaim
`org available → agent stipend` / reverse

### 3.3 Pay (transfer / x402)
```
Intent → Simulate → Policy
  DENY → Decision(denied) → agent error POLICY_DENIED
  REVIEW → Approval wait → timeout DENY or guardian ALLOW
  ALLOW → hold stipend → sign UserOp → broadcast
       → confirm → finalize ledger → webhook payment.succeeded
       → fail → release hold → payment.failed
```

### 3.4 Escrow
`lock (fund hold) → release | refund | timeout_refund | dispute→guardian`

### 3.5 Withdraw
`agent→org sweep` then `org→external` only if allowlisted + policy + often HITL

### 3.6 Freeze
Stops **new** spends; define explicitly whether in-flight UserOps still complete

### 3.7 Task ↔ money liaison
- Every agent tool call requires structured Intent (not free text)
- Optional `job_id` tags spend to a Job/Escrow
- Agent continues task only after tool returns success + receipt
- **Liaison = tool boundary**, not chat

---

## 4. Guardian UI (screens)

| Screen | Purpose / primary actions |
|--------|---------------------------|
| Onboarding | Create org, connect/deposit USDC, pick template policy |
| Vault overview | Balances, at-risk, recent decisions |
| Agents | Create/freeze agents, stipends, keys |
| Agent detail | Budget, activity, policy overrides |
| Policy editor | Caps, allowlists, thresholds + **Simulator** |
| Approvals inbox | Approve/deny with context |
| Activity / ledger | Filter by agent/job; open decision trace |
| Escrow & jobs | Create job, lock, release, dispute |
| Deposit / withdraw | Addresses, confirmations, HITL |
| Settings | Guardians, webhooks, allowlists, API keys |
| Alerts & freezes | Kill switch, incident banner |
| P&L / exports | Per-agent CSV, date range |

**Telegram/Slack mini-flow:** push approval card → Approve / Deny / Freeze agent.

**UX principles:** Denials explain `rule_id`; freeze always visible; money screens show micro-USDC formatted; footer: *Not a bank. Not FDIC insured.*

---

## 5. Agent surface (SDK / MCP / HTTP)

### 5.1 Tools (MVP)

| Tool | Purpose |
|------|---------|
| `get_budget` | available / held / caps remaining |
| `simulate_payment` | dry-run policy |
| `pay` | USDC transfer allowlisted |
| `pay_api` / `x402_pay` | pay for HTTP resource |
| `transfer_internal` | same-org agent |
| `invoice_create` / `invoice_pay` | bill/settle |
| `escrow_lock` / `release` / `refund` / `status` |
| `get_decision` | explain last deny |
| `list_activity` | recent intents |

### 5.2 Auth
- Agent API keys with scopes: `read`, `pay`, `escrow`, `admin` (narrow)
- Short-lived session tokens preferred
- MFA for guardian policy edits (when available)

### 5.3 Error codes
`POLICY_DENIED`, `INSUFFICIENT_STIPEND`, `NEEDS_APPROVAL`, `APPROVAL_TIMEOUT`, `FROZEN`, `ALLOWLIST_MISS`, `IDEMPOTENCY_REPLAY`, `RAIL_FAILED`, `RECONCILE_STALE`

### 5.4 Agent author rules
- Always send `idempotency_key`
- Always send `job_id` when under a client job
- Treat tool denials as recoverable task errors
- Never retry forever on `POLICY_DENIED` (loop detector will freeze)

### 5.5 Example binding

```text
plan step "need data"
  → pay_api(vendor, 1.20, job_id, idem)
  → if ok: use payload in next LLM step
  → if POLICY_DENIED: replan without paid tool or escalate
```

---

## 6. Features & actions catalog (by phase)

### MVP (Y) — must ship
- Org/guardian/agent CRUD, freeze
- Vault deposit USDC, allocate/reclaim/sweep
- Policy: daily/tx caps, allowlists, new-counterparty cooldown, HITL threshold, simulate
- pay + x402 pay + internal transfer
- Escrow lock/release/refund/timeout
- Decision traces + activity feed
- Telegram approve/deny/freeze
- SDK + MCP + webhooks (payment.*, escrow.*, policy.denied)
- Idempotency, rate limits, KYT/sanctions hook on outbound
- Legal copy: not a bank / not FDIC
- Integer USDC ledger + reconcile job

### Phase 2 — commerce & org finance
- Invoices, subscriptions/metering, splits/royalties
- Multi-guardian quorum, P&L dashboards
- Dispute desk, client sub-accounts
- Eliza/LangGraph/Crew first-class plugins
- NFT mint/list **allowlisted only**

### Phase 3 — identity & network
- Skyfire KYA / World ID / ERC-8004 hooks
- Cross-org A2A marketplace with bonds
- Stripe → USDC stipend on-ramp (partner)
- AP2 mandates optional path

### Phase 4 — token (only after GMV gates)
- Non-transferable Points → claim
- ABI: fee discount, slashable bonds, **not** deposit asset
- Emissions pause if fee revenue = 0
- TGE gates: real USDC volume, audited escrow, public dashboards, 0% team unlock at TGE

### Explicit non-goals (MVP)
- Open DEX trading hub for agents
- Fiat custody you operate
- Yield on balances / “savings”
- LLM-interpreted policies
- Raw keys in agent env
- Bridges, unlimited approvals
- Public token launch

---

## 7. External connections

| Integration | Enables |
|-------------|---------|
| Coinbase CDP / Agentic Wallets | Custody, gasless, KYT |
| x402 facilitators | Machine pay for APIs |
| ERC-4337 bundlers | UserOp submission / fallback |
| Base USDC | Settlement |
| Eliza / LangGraph / Crew | Agent runtimes |
| Telegram / Slack | Guardian HITL |
| Goldsky / indexer | Confirmations & reconcile |
| Chainalysis/TRM-class API | Screening |
| Skyfire / World ID (later) | KYA / personhood |
| Stripe (later) | Fiat → stipend |
| Status page + docs site | Trust & DX |

---

## 8. Safety, errors, edge cases

### 8.1 Threat priorities
Prompt injection drain · session key theft · policy bypass · insider · bundler outage · SC escrow bug · wash volume · OFAC hit · tenant IDOR

### 8.2 Mitigations (MVP)
Default deny · structured intents only · keys in TEE/AA · allowlists · caps · HITL · simulate · freeze · sanctions screen · no LLM policy · tenant RLS · loop detection

### 8.3 Failure behavior
| Failure | Behavior |
|---------|----------|
| Duplicate pay submit | Same idempotency result |
| Chain fail after hold | Release hold; alert |
| Paid rail but ledger write fails | Reconcile worker repairs; page on-call |
| Guardian offline | Approval timeout → deny (fail closed) |
| Indexer lag | Read-only / delay finality |
| Policy edit mid-flight | Pin policy_version on Intent start |
| Concurrent escrow release | Row lock / state machine single winner |

### 8.4 Testing
Unit (money math) · property tests on micro-USDC · policy fuzz · integration Sepolia · chaos duplicate webhooks · red-team jailbreak drills · load 2× agent loops · pen test before mainnet money

### 8.5 Incident outline
Detect → freeze scope → revoke session keys → notify guardians → reconcile → postmortem → policy harden

---

## 9. Non-functional annex (from gap checklist — must track)

**Prioritize first:** tenant isolation · 6-decimal invariants · webhook idempotency · freeze semantics · key/guardian recovery · gas/cost who-pays

Also include in backlog:
- UTC policy windows + TZ UI labels; clock skew tolerance
- Webhook dual-secret rotation, DLQ, manual replay (audited)
- Soft-delete vs freeze vs legal hold definitions
- Lost-phone guardian recovery with delay + notify all
- Staging/prod drift CI (chain IDs, DSL version)
- Support **read-only**; never impersonate pay
- Docs + status page + runbooks
- Feature flags default-off for money paths; global spend kill switch
- Policy DSL semver + side-by-side simulation on migrate
- Backup/DR RPO/RTO; quarterly restore drill
- Gas payer model documented; subsidy caps per tier
- SBOM, secret redaction, CSP headers

---

## 10. Build roadmap

### Week 1 — decisions (ADRs)
1. Custody: CDP Agentic Wallets vs self AA  
2. Policy engine language: YAML/JSON rules vs tiny DSL  
3. Ledger: single Postgres service vs separate  
4. Orchestration: Temporal vs queue  
5. Product name (PolicyVault vs ABI public brand)  
6. Who pays gas (platform paymaster vs user)

### Weeks 1–2 — foundation
Monorepo, Sepolia, factory account, org/agent schema, CI, legal footer copy

### Weeks 3–5 — policy + ledger + guardian UI
Caps/allowlists/HITL, allocate, decision traces, freeze, Telegram bot

### Weeks 6–8 — x402 + escrow
End-to-end Maya loop on testnet; webhooks; SDK/MCP

### Weeks 9–10 — harden
Reconcile, rate limits, KYT stub, chaos tests, design partners

### Weeks 11–12 — private beta
Mainnet optional small caps; docs; metrics dashboard; **no TGE**

### Exit criteria private beta
- 5+ design partners  
- Jailbreak drain demo blocked on video  
- Escrow job completed with receipts  
- Zero critical reconcile incidents in staging week  
- Support runbook + kill switch tested  

### Phase 2–4
As in §6; token only after published GMV gates.

---

## 11. Monorepo sketch

```text
apps/web-guardian
apps/api
apps/mcp-server
apps/workers          # indexer, webhooks, reconcile
packages/sdk-ts
packages/policy-engine
packages/ledger
packages/custody
packages/common
contracts/            # Foundry escrow (phase)
docs/
```

---

## 12. Staffing (MVP)

- Tech lead / architect  
- Full-stack (guardian UI + API)  
- Backend money/ledger engineer  
- Optional: smart contract (escrow) part-time  
- Design partner manager / founder for demos  
- Counsel on retainer (architecture review before mainnet)

---

## 13. Definition of Done — “we built the product”

A guardian can deposit USDC, fund agents with policies, an agent can complete a paid multi-step job via MCP tools under those policies, escrow can settle on delivery, a prompt-injection drain is denied with a trace, and the guardian can freeze in one tap — on Base, with reconciliation and webhooks — **without** a token and **without** calling it a bank.

---

## 14. Document history / sources

Synthesized from product/architecture planning in this project, prior Economic OS / ABI canvases, and the non-functional gap checklist from the build-pitfalls pass. Re-run Opus/Fable deep-dives when API quota allows to expand any section.

**Related docs (project-local):** see [`docs/INDEX.md`](docs/INDEX.md)

- `docs/canvases/ai-agent-economic-os-plan.canvas.tsx`
- `docs/canvases/artificial-banking-inc-plan.canvas.tsx`
- `docs/canvases/abi-gtm-fundraising.canvas.tsx`
- `docs/canvases/abi-stress-test-briefing.canvas.tsx`
