# PolicyVault (ABI) — Validation Build Rundown

> **Archived — point-in-time.** Written July 2026. Kept for history; it is not a
> description of the current system and is not maintained. The living documents
> are [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) and
> [`docs/ROADMAP.md`](../ROADMAP.md).

**Status:** AWAITING YOUR VALIDATION — do not start coding until you reply **APPROVED** (with any changes).  
**Working product name:** PolicyVault  
**Optional OpCo name:** Artificial Banking Inc  
**MVP money:** USDC on Base  
**Hard rule:** LLM proposes · policy + signer authorize · keys never in the model  
**Not in MVP:** public token, fiat bank, open DEX trading, yield/savings, “FDIC bank” branding

---

## A. Product in one breath

Humans deposit USDC into an **org vault**, allocate **stipends** to **agents**, set **policies** (caps, allowlists, approvals). Agents spend only through **SDK/MCP tools**. Escrow holds client job funds until delivery. Guardians approve outliers and can **freeze** anything. Every decision is logged.

**Demo north star (Maya loop):** deposit → 3 agents budgeted → $25 escrow job → agents pay allowlisted APIs → PDF delivered → escrow releases → jailbreak drain blocked → freeze works.

---

## B. Who uses what

| Actor | Interface | Can do |
|-------|-----------|--------|
| **Guardian** (human) | Web app + Telegram | Fund, policy, approve, freeze, withdraw, view P&L |
| **Agent** (runtime) | MCP / HTTP SDK | `get_budget`, `pay`, `pay_api`, `escrow_*`, etc. |
| **System** | Workers | Reconcile, webhooks, timeouts, KYT |
| **Admin** (you) | Internal later | Support read-only — never impersonate pay |

---

## C. Architecture (what we will build)

### C.1 Diagram

```
┌─────────────────────────────────────────────────────────────┐
│  Guardian Web (Next.js)     Telegram Bot (approve/freeze)   │
└───────────────────────────────┬─────────────────────────────┘
                                │ HTTPS / session auth
┌───────────────────────────────▼─────────────────────────────┐
│  API Gateway — auth, rate limit, org scoping                │
└─┬─────────────┬─────────────┬─────────────┬─────────────────┘
  │             │             │             │
  ▼             ▼             ▼             ▼
Policy       Ledger       Commerce      Custody
Engine       Service      (escrow/jobs) Adapter
  │             │             │             │
  └──────┬──────┴──────┬──────┘             │
         ▼             ▼                    ▼
    Decision Log    Postgres           TEE / ERC-4337
         │          Redis              Signer → Base USDC
         ▼             │                    │
    Webhooks ◄─────────┴── Indexer/Reconcile┘
         │
         ▼
  Agent MCP Server / @policyvault/sdk
```

### C.2 Services (MVP repo packages)

| Package / app | Builds |
|---------------|--------|
| `apps/web` | Guardian UI |
| `apps/api` | REST API |
| `apps/mcp-server` | Agent tools |
| `apps/worker` | chain index, webhooks, escrow timeouts, reconcile |
| `apps/telegram-bot` | HITL actions |
| `packages/policy` | rule eval + simulate |
| `packages/ledger` | micro-USDC double-entry |
| `packages/custody` | CDP or AA wallet adapter |
| `packages/sdk` | TypeScript client |
| `packages/db` | Prisma/Drizzle schema + migrations |
| `contracts/` | Escrow (Foundry) — can start as DB-escrow then on-chain |

### C.3 Stack choices (validate these)

| Choice | Proposal | Alt |
|--------|----------|-----|
| Chain | Base Sepolia → Base mainnet | — |
| Stablecoin | USDC (integer micro-units) | — |
| Custody v1 | **Coinbase CDP Agentic Wallets** | Self ERC-4337 |
| API | Node/TS (Fastify or Hono) | — |
| DB | Postgres + Prisma | — |
| Queue | BullMQ + Redis | Temporal later |
| Web | Next.js App Router | — |
| Auth guardian | Clerk or Auth.js + email | Wallet login later |
| Escrow v1 | **DB state machine + vault holds** | On-chain escrow Phase 2 |
| x402 | Coinbase facilitator where possible | Stub mock in week 1–4 |

**Week-1 ADR lock:** custody provider + escrow on-chain vs off-chain.

---

## D. Complete feature / action inventory

Legend: **M** = MVP build · **P2** = Phase 2 · **P3+** = later · **OUT** = not building now

### D.1 Org & identity

| ID | Feature / action | Actor | Phase |
|----|------------------|-------|-------|
| O1 | Sign up / sign in | Guardian | M |
| O2 | Create org | Guardian | M |
| O3 | Rename org / org settings | Guardian | M |
| O4 | Invite second guardian (email) | Guardian | P2 |
| O5 | Roles: owner / operator / viewer | Guardian | P2 |
| O6 | Create agent | Guardian | M |
| O7 | Rename / archive agent | Guardian | M |
| O8 | Freeze / unfreeze agent | Guardian | M |
| O9 | Freeze / unfreeze entire org | Guardian | M |
| O10 | Rotate agent API key | Guardian | M |
| O11 | Revoke all agent keys | Guardian | M |
| O12 | Link Telegram for approvals | Guardian | M |
| O13 | Operator KYC light (stub → real) | System | P2 |
| O14 | KYA / World ID bind | Agent/Org | P3 |

### D.2 Money: vault, deposit, allocate, withdraw

| ID | Feature / action | Phase |
|----|------------------|-------|
| V1 | Show org vault address + QR | M |
| V2 | Detect incoming USDC deposit (indexer) | M |
| V3 | Credit ledger after N confirmations | M |
| V4 | Allocate stipend to agent | M |
| V5 | Reclaim stipend to org | M |
| V6 | Sweep agent → org | M |
| V7 | Internal transfer agent ↔ agent (same org) | M |
| V8 | Withdraw org → external allowlisted address | M |
| V9 | Withdraw requires HITL above threshold | M |
| V10 | Show available / held / pending balances | M |
| V11 | Fiat on-ramp (Stripe→USDC) | P3 |
| V12 | Multi-chain | OUT |

### D.3 Policy engine & settings

| ID | Setting / action | Phase |
|----|------------------|-------|
| P1 | Per-tx max USDC | M |
| P2 | Daily max USDC (per agent) | M |
| P3 | Monthly max USDC | P2 |
| P4 | Address allowlist | M |
| P5 | Domain / x402 vendor allowlist | M |
| P6 | Contract allowlist | M |
| P7 | Blocklist | M |
| P8 | New counterparty cooldown (hours) | M |
| P9 | HITL if amount > X | M |
| P10 | HITL if action in category (withdraw, escrow release) | M |
| P11 | Session / velocity: max N pays per minute | M |
| P12 | Policy simulator (dry-run intent) | M |
| P13 | Policy templates: Solo / Swarm / API Seller | M |
| P14 | Policy version history + pin on intent | M |
| P15 | Require `job_id` for pays (org toggle) | P2 |
| P16 | LLM-written policies | OUT |
| P17 | Natural-language policy | OUT |

### D.4 Payments & rails

| ID | Action | Phase |
|----|--------|-------|
| R1 | `pay` USDC transfer | M |
| R2 | `pay_api` / x402 purchase | M |
| R3 | `simulate_payment` | M |
| R4 | Idempotent replay | M |
| R5 | Platform fee skim (bps) on settle | P2 |
| R6 | Gas sponsorship (paymaster) | M |
| R7 | Receive x402 as seller | P2 |

### D.5 Escrow, jobs, invoices

| ID | Action | Phase |
|----|--------|-------|
| E1 | Create job | M |
| E2 | Escrow lock funds | M |
| E3 | Escrow release on deliverable hash / guardian ack | M |
| E4 | Escrow refund | M |
| E5 | Escrow timeout auto-refund | M |
| E6 | Dispute → guardian decide | P2 |
| E7 | Invoice create / pay | P2 |
| E8 | Splits (platform / referrer) | P2 |
| E9 | Nested sub-escrow | P3 |

### D.6 Agent tools (MCP/SDK) — MVP set

| Tool | Description |
|------|-------------|
| `get_budget` | balances + remaining caps |
| `simulate_payment` | policy preview |
| `pay` | allowlisted transfer |
| `pay_api` | x402 / metered API pay |
| `transfer_internal` | same-org |
| `escrow_status` | state of job escrow |
| `escrow_lock` | lock (if agent allowed) |
| `request_release` | propose release w/ deliverable_hash |
| `get_decision` | last deny explanation |
| `list_activity` | recent intents |

### D.7 Safety & compliance services

| ID | Feature | Phase |
|----|---------|-------|
| S1 | Default-deny policy | M |
| S2 | Decision audit trail | M |
| S3 | Kill switch UI + API | M |
| S4 | Loop detection (same intent spam) | M |
| S5 | Outbound sanctions/KYT hook | M |
| S6 | Ledger↔chain reconcile job | M |
| S7 | Feature flag global spend kill | M |
| S8 | “Not a bank / not FDIC” footer | M |
| S9 | Support read-only console | P2 |
| S10 | Token / points / TGE | P4 after GMV |

### D.8 Notifications

| Channel | Events (MVP) |
|---------|----------------|
| In-app | approval needed, denied, freeze, deposit confirmed |
| Telegram | approve / deny / freeze buttons |
| Email | P2 digest |
| Webhooks | `payment.*`, `escrow.*`, `policy.denied`, `agent.frozen`, `deposit.confirmed` |

---

## E. Settings panels (exact UI settings)

### E.1 Org settings
- Org name  
- Default policy template  
- Withdrawal HITL threshold  
- Require Telegram linked for mainnet spends (toggle)  
- Webhook endpoints + signing secret rotate  
- Danger: freeze org / close org  

### E.2 Agent settings
- Display name  
- Stipend target / auto-top-up (P2)  
- Attached policy (org default or override)  
- API key create/reveal-once/revoke  
- MCP connection snippet  
- Status: active / frozen / archived  

### E.3 Policy settings (form fields)
- `per_tx_max_usdc`  
- `daily_max_usdc`  
- `max_pays_per_minute`  
- `new_counterparty_cooldown_hours`  
- `hitl_above_usdc`  
- Allowlists: addresses[], domains[], vendors[]  
- Blocklists[]  
- Categories requiring HITL: withdraw, release_escrow, (P2: nft_mint)  
- Buttons: Save draft · Publish version · Simulate  

### E.4 Notification settings
- Telegram link/unlink  
- Which events notify  
- Approval timeout minutes (default 30; fail closed → deny)  

### E.5 Security settings
- Session logout  
- (P2) MFA enforce  
- Export audit CSV  

---

## F. Guardian UI — screen-by-screen

**Visual direction (validate):** dark operational console, high clarity, no meme-coin vibes; accent = one solid brand color (not purple gradient cliché); money always monospace; status pills: Active / Frozen / Pending / Denied.

### F.1 Auth
- Email magic link / password  
- Empty: “Create your first org”  

### F.2 Onboarding wizard (3 steps)
1. Name org  
2. Show deposit address + “send test USDC on Sepolia”  
3. Pick template policy + create first agent  

### F.3 Home / Vault overview
- **Hero stats:** Available USDC · In stipends · In escrow · Denied (24h)  
- **CTA:** Deposit · Allocate · Create agent  
- **Feed:** last 20 decisions (color: green allow / red deny / amber review)  
- **Banner if frozen**  

### F.4 Agents list
- Table: name, stipend available, spent 24h, status, last active  
- Actions: Create · Freeze selected  

### F.5 Agent detail
- Tabs: Overview · Activity · Policy · Keys  
- Budget dial / numbers  
- “Open in simulator” with prefilled agent  

### F.6 Policy editor
- Left: form fields (§E.3)  
- Right: live summary (“Agent may spend ≤ $3/tx, ≤ $50/day, only 3 vendors…”)  
- Simulator drawer: amount, destination, tool → Allow/Deny/Review + rule ids  

### F.7 Approvals inbox
- Cards: agent, amount, destination, job_id, expires in Mm  
- Buttons: Approve · Deny · Freeze agent  
- Empty: “No pending approvals”  

### F.8 Activity / ledger
- Filters: agent, job, outcome, date  
- Row click → Decision trace drawer (intent JSON, rules, tx hash)  

### F.9 Jobs & escrow
- List jobs + state machine badge  
- Create job modal: title, amount, timeout, payer (org)  
- Detail: timeline lock → pays tagged → release/refund  

### F.10 Deposit
- Address, network Base, copy, QR  
- Pending deposits list  

### F.11 Withdraw
- Amount, destination (must be allowlisted)  
- If over threshold: “Will request your approval”  
- Confirm  

### F.12 Settings
- Sections: Org · Notifications · Webhooks · Security · Legal  

### F.13 Mobile
- Approvals + freeze must work on narrow screens  
- Full policy editor desktop-first  

### F.14 Telegram mini UI
```
[Approval] Researcher wants $12.00 → api.data.example
Job: competitor_brief_042
[Approve] [Deny] [Freeze agent]
```

---

## G. Agent interface (how runtimes connect)

### G.1 Auth
`Authorization: Bearer pv_agent_…` with scopes `read|pay|escrow`

### G.2 Error codes (stable contract)
`POLICY_DENIED` · `INSUFFICIENT_STIPEND` · `NEEDS_APPROVAL` · `APPROVAL_TIMEOUT` · `FROZEN` · `ALLOWLIST_MISS` · `IDEMPOTENCY_REPLAY` · `RAIL_FAILED` · `RECONCILE_STALE`

### G.3 Task ↔ money pattern
```
plan step
  → tool pay_api({ amount, vendor, job_id, idempotency_key })
  → wait result
  → if ok: continue with paid data
  → if POLICY_DENIED: replan or escalate to human
```

### G.4 Docs snippets to ship
- LangGraph tool wrapper example  
- Eliza plugin example  
- Raw MCP Cursor/Claude config JSON  

---

## H. Data model (build schema)

Tables: `orgs`, `guardians`, `agents`, `vaults`, `stipend_accounts`, `policies`, `policy_versions`, `allowlist_entries`, `intents`, `decisions`, `approvals`, `ledger_accounts`, `journal_entries`, `journal_lines`, `chain_txs`, `jobs`, `escrows`, `api_keys`, `webhook_endpoints`, `webhook_deliveries`, `freeze_events`, `deposits`

**Money:** `BIGINT` micro-USDC only. **No float.**

---

## I. Critical flows (acceptance scripts)

1. **Deposit credit** — send USDC → appears available after confirmations  
2. **Allocate** — org 100 → agent 40  
3. **Allow pay** — allowlisted $1.20 x402/mock succeeds; ledger matches  
4. **Deny drain** — transfer to random address → `POLICY_DENIED` + Telegram alert  
5. **HITL** — $50 pay → pending → Approve → succeeds  
6. **HITL timeout** — no answer → deny fail-closed  
7. **Escrow job** — lock 25 → tag pays → release → balances correct  
8. **Freeze** — mid-flight new pays rejected  
9. **Idempotency** — same key twice → one debit  
10. **Reconcile** — forced mismatch alerts  

---

## J. Non-functional musts (MVP)

- Tenant `org_id` on every query  
- Idempotency keys on all pays  
- Webhook at-least-once + signature + dedupe id  
- Global + per-agent rate limits  
- UTC clocks; policy windows documented  
- Append-only decisions  
- Staging ≠ prod chain config CI check  
- Legal footer on every page  
- Who pays gas: **platform paymaster with per-org daily gas subsidy cap** (validate)

---

## K. Build phases (execution after approval)

### Phase 0 — Project bootstrap (day 1–2)
- Create repo `policyvault` (or your name)  
- Monorepo Turborepo, CI, env templates  
- Postgres schema v1, Sepolia config  
- Footer legal copy  

### Phase 1 — Skeleton money (week 1–2)
- Auth + org + agent CRUD UI  
- Vault address + mock/indexer deposit  
- Allocate / balances UI  
- Ledger postings  

### Phase 2 — Policy heart (week 3–5)
- Policy engine + editor + simulator  
- pay + deny paths  
- Telegram approvals  
- Freeze  

### Phase 3 — Commerce + agent DX (week 6–8)
- Escrow/jobs UI + API  
- MCP server + SDK  
- x402 or faithful mock → real facilitator  
- Webhooks  
- Maya E2E demo script automated  

### Phase 4 — Harden private beta (week 9–12)
- Reconcile, KYT hook, chaos tests  
- Docs site  
- Design partner onboarding  
- Optional small mainnet caps  
- **No token**  

### After validation of beta metrics
- Phase 2 product features (invoices, multi-guardian, plugins)  
- Token only with explicit new approval  

---

## L. Out of scope until you say otherwise

- ABI token / TGE / points  
- Calling product a “bank” in UI  
- Open agent token trading  
- NFT marketplace  
- Mobile native apps  
- Multi-chain  
- Yield  
- Anonymous public signup without rate limits  

---

## M. Validation checklist — reply with decisions

Please reply **APPROVED** or **APPROVED WITH CHANGES**, and answer:

1. **Product name:** PolicyVault / something else?  
2. **Repo/folder name:** `policyvault` / other?  
3. **Custody:** Coinbase CDP Agentic Wallets **or** self ERC-4337?  
4. **Escrow MVP:** off-chain holds in vault **or** on-chain contract day one?  
5. **x402:** real facilitator as soon as possible **or** mock until week 6?  
6. **Guardian auth:** email (Clerk/Auth.js) OK for MVP?  
7. **UI theme:** dark operational (proposed) OK?  
8. **Telegram in MVP:** yes/no?  
9. **Anything to add/remove** from feature lists D/E/F?  

---

## N. After you validate

I will:
1. Confirm project path / create project + `move_agent_to_root`  
2. Scaffold monorepo  
3. Implement in phase order above  
4. Keep token & bank branding out until you explicitly green-light  

**No code until your validation message.**
