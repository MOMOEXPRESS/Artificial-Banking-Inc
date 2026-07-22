# PolicyVault

Policy-gated **USDC treasury & payments OS** for AI agents.

> LLM proposes. Policy + signer authorize. Keys never enter the model.  
> **Not a bank. Not FDIC insured.**

**Live console (Vercel):** https://artificial-banking-inc-gaia10.vercel.app  
Do **not** open `artificial-banking-inc.vercel.app` — that hostname is unassigned and returns Vercel platform 404. Access harden: `VERCEL_TOKEN=… npm run vercel:harden` (see [`docs/VERCEL.md`](docs/VERCEL.md)).

Validated build rundown and all planning docs: see [`docs/INDEX.md`](docs/INDEX.md) (canonical: validation rundown + full-scale build plan + this README).

## Monorepo

| Path | Role |
|------|------|
| `apps/api` | Guardian + agent HTTP API (in-memory demo ledger) |
| `apps/web` | Guardian console (Next.js) |
| `apps/mcp-server` | MCP tools for agent runtimes |
| `apps/worker` | Reconcile/webhook stub |
| `apps/demo-agent` | Runnable example agent (SDK, full money loop) |
| `apps/x402-seller` | Demo paid API (x402 seller) + dev facilitator |
| `packages/common` | Money types (micro-USDC), error codes |
| `packages/policy` | Deterministic policy engine |
| `packages/ledger` | Double-entry helpers |
| `packages/sdk` | TypeScript agent client |
| `packages/db` | Prisma schema (Postgres — next wiring step) |

## Quick start

```bash
cd C:\Users\ebale\Projects\policyvault
npm install
npm run build -w @policyvault/common -w @policyvault/policy -w @policyvault/ledger -w @policyvault/sdk
npm run test
npm run dev:api
```

In another terminal:

```bash
npm run dev:web
```

1. Open http://localhost:3000  
2. Click **Bootstrap demo org**  
3. **Allocate to Researcher**  
4. **Agent pay $1.20 (allow)** — should succeed  
5. **Agent pay $15 (review)** — lands in the **Approvals inbox**; Approve executes it, Deny kills it  
6. **Simulate drain (deny)** — should return `POLICY_DENIED`  
7. **Escrow $5 → Writer** — locks funds; Release moves them to Writer, Refund returns them (auto-refund on timeout)  
8. **Freeze agent** — kill switch; further pays deny with an `agent_frozen` trace. **Unfreeze** restores.  

API default: `http://localhost:8787`  
Web expects `NEXT_PUBLIC_API_URL` (defaults to that).

### Policy bands (demo template)

Allow < **$10** ≤ needs guardian approval (review) < **$25** ≤ hard deny (`per_tx_max`).  
Daily cap $50, max 10 pays/minute, allowlist-only destinations, unknown counterparties go to review.

### HTTP surface

Agent (Bearer `pv_agent_...`): `GET /v1/agent/budget`, `POST /v1/agent/simulate`,
`POST /v1/agent/pay`, `POST /v1/agent/pay_api`, `POST /v1/agent/escrow/lock`,
`GET /v1/agent/escrow/:id`, `POST /v1/agent/escrow/:id/release|refund`,
`GET /v1/agent/approvals/:id` (poll after a 202 `NEEDS_APPROVAL`).

Guardian: `GET /v1/guardian/org|activity|approvals|escrows`,
`POST /v1/guardian/allocate|freeze|unfreeze`,
`POST /v1/guardian/approvals/:id/resolve`, `POST /v1/guardian/escrows/:id/resolve`.

Approvals expire (default 10 min) and locked escrows auto-refund at timeout via a background sweep.

### Try it yourself — the Agent Playground

Open the console → **Agent Playground**. Pick a mission, press **Run**, and watch a real agent
spend real balances through the real policy engine. Nothing is mocked for the demo — every step
is the same HTTP API a production agent would call.

| Mission | What you'll see |
|---|---|
| **Research brief** | Budget check → x402 purchase → API payment → hires a peer under escrow → releases it |
| **Large purchase** | The agent hits your approval threshold, **parks**, alerts you, and resumes by itself once you approve |
| **Compromised agent** | Prompt-injected drain attempts, all denied with the exact rule that fired |

Missions keep running if you navigate away — the rail shows a live dot while one is in flight.
Each step reports a plain-English result with the raw API response tucked behind a toggle, and
every finished run is archived in **Work & deliverables** with the document it produced, the full
step history and what it cost. From there you can bill the work as an invoice in one click.

### Insights

The **Insights** screen answers four questions from your own ledger — no models,
no estimates, every number traceable to a row:

- **P&L** — what each mission cost against what it was billed for, with the return multiple
- **Vendors** — spend per counterparty, allowlist status, blocked attempts, concentration warning
- **Forecast** — burn per hour and when each agent hits its cap. Refuses to project from a window
  too short to be meaningful rather than printing an impressive-looking fabrication
- **Anomalies** — confidence-scored oddities in *allowed* spend (unusual size, odd hour, first-ever
  counterparty, burst activity) so you can tighten a rule that a hard limit would not have caught

### Policy simulator

The Policy screen replays the last 7 days of real decisions against your unsaved edits:
*"5 of 13 past decisions would change. Expect roughly 0.7 more approval interruptions per day.
$13.20 of past spend would have been stopped."* Drag a limit, see the consequence, then decide.

### Moving money

Funds move three ways, all as single balanced journals:

| Direction | Endpoint | Use |
|---|---|---|
| Treasury → agent | `POST /v1/guardian/allocate` | Fund an agent |
| Agent → treasury | `POST /v1/guardian/reclaim` | Undo a mistaken allocation |
| Agent → agent | `POST /v1/guardian/transfer` | Funded the wrong agent |

Reclaim and transfer accept an omitted amount to move everything available.
Neither can touch funds held mid-payment or locked in escrow — those belong to
an in-flight commitment.

### Security posture

The money paths are covered by a regression suite (`security.mjs`) that proves
the guarantees hold, not just that the happy path works:

- **Idempotency is reserved before execution**, so two concurrent retries of the
  same payment settle exactly once — the x402 rail awaits network I/O for up to
  25s, and a check-then-write left that whole window open to double-spend.
- **Approvals re-run the policy engine at execution time.** A guardian's
  approval satisfies the human-in-the-loop rule; it does not waive caps,
  freezes or the blocklist. A queue of individually-legal approvals can no
  longer collectively blow the daily cap.
- **Approvals are claimed atomically** — console and Telegram pressing Approve
  simultaneously execute once.
- **Allowlists vote only when configured.** An empty list never means "allow
  everything"; a domain-only setup no longer waves through every destination.
  Suffix matching is dot-anchored, so `api.openai.com.attacker.net` is refused.
- **The x402 rail validates what it signs**: token contract pinned per network,
  payee format-checked and blocklist-checked, price sanity-checked, and the
  authorization validity window clamped regardless of what the seller asks.
- **Quorum counts authenticated identities**, so one guardian cannot satisfy a
  2-of-N quorum by voting twice under different names.

### Connecting an agent

An agent is just an HTTP client with a Bearer key. It never touches keys or the
vault — it calls money verbs; the policy engine decides.

```bash
# 1. Create an org (mock USDC deposit) — returns { orgId, guardianKey } once
curl -s -X POST http://localhost:8787/v1/guardian/orgs \
  -H "Content-Type: application/json" -d '{"name":"Acme Agent Co","depositUsdc":"50"}'

# 2. Guardian creates an agent (guardian key required from here on)
curl -s -X POST http://localhost:8787/v1/guardian/agents \
  -H "Authorization: Bearer pv_guardian_..." \
  -H "Content-Type: application/json" -d '{"name":"Analyst"}'
# -> returns { agentId, apiKey } — the key is shown exactly once

# 3. Guardian allocates a stipend
curl -s -X POST http://localhost:8787/v1/guardian/allocate \
  -H "Authorization: Bearer pv_guardian_..." \
  -H "Content-Type: application/json" \
  -d '{"agentId":"agt_...","amountUsdc":"30"}'

# 4. The agent spends under policy
curl -s http://localhost:8787/v1/agent/budget -H "Authorization: Bearer pv_agent_..."
```

Three integration surfaces, same API key:

- **REST** — the curl calls above
- **TypeScript SDK** — `new PolicyVaultClient({ baseUrl, apiKey })` from `@policyvault/sdk`
- **MCP** — `apps/mcp-server` exposes the verbs as MCP tools for Claude/Eliza/LangGraph runtimes

Runnable example (full loop: budget → simulate → pay → denied drain → HITL
approval wait → escrow hire):

```bash
set POLICYVAULT_API_KEY=pv_agent_...
set PAYEE_AGENT_ID=agt_...   # optional, enables the escrow demo
npm run demo:agent
```

### Persistence

The API is backed by **SQLite** (better-sqlite3, WAL) at
`apps/api/data/policyvault.db` — real tables, transactional double-entry
journal application, durable across restarts, no Docker needed. All SQL lives
behind `apps/api/src/store.ts`; swapping in Postgres/Prisma (`packages/db`)
later means reimplementing that one module.

### Guardian auth

Every `/v1/guardian/*` route requires `Authorization: Bearer pv_guardian_...`.
The key is returned once by `POST /v1/guardian/orgs` (or dev bootstrap); the
org is always derived from the key, never from request params.

### x402 payments (real protocol, local settlement)

`pay_api` with an **http(s) destination** runs the actual x402 client dance:
PolicyVault fetches the resource, receives the HTTP 402 payment requirements,
checks the seller's price against the policy-authorized amount, signs an
EIP-712 `TransferWithAuthorization` with the org's custody key (a real EVM
keypair generated per org), retries with the `X-PAYMENT` header, and hands the
**paid resource + settlement receipt** back to the agent. Only the seller's
actual price is settled — the unspent remainder of the hold is released.

Try it (seller runs on :9402, charges $1.20):

```bash
npm run dev -w @policyvault/x402-seller   # paid API + dev facilitator
# allowlist the seller domain, then:
curl -s -X POST http://localhost:8787/v1/guardian/policy \
  -H "Authorization: Bearer pv_guardian_..." -H "Content-Type: application/json" \
  -d '{"domainAllowlist":["localhost"]}'
curl -s -X POST http://localhost:8787/v1/agent/pay_api \
  -H "Authorization: Bearer pv_agent_..." -H "Content-Type: application/json" \
  -d '{"amountUsdc":"2","destination":"http://localhost:9402/report","idempotencyKey":"try_x402_1"}'
# -> { rail: "x402", amountUsdc: "1.2", txHash, resource: {...the report...} }
```

The dev facilitator verifies signatures cryptographically but fakes onchain
settlement. **Go-live path:** point the seller at the hosted x402 facilitator,
fund the org wallet with Base USDC, and swap dev keys for CDP/TEE custody —
the client dance is unchanged.

### Policy editing

`GET /v1/guardian/policy` shows current rules; `POST /v1/guardian/policy`
merges partial updates (`perTxMaxUsdc`, `dailyMaxUsdc`, `hitlAboveUsdc`,
allowlists, blocklist, `hitlCategories`, velocity). Bands must nest:
allow < `hitlAboveUsdc` ≤ review < `perTxMaxUsdc` ≤ deny.

### Webhooks

```bash
curl -s -X POST http://localhost:8787/v1/guardian/webhooks \
  -H "Authorization: Bearer pv_guardian_..." \
  -H "Content-Type: application/json" -d '{"url":"https://your-receiver/hook"}'
# -> { id, secret }  (secret shown once)
```

Events: `payment.succeeded|failed`, `policy.denied`, `approval.pending|resolved`,
`escrow.locked|released|refunded`. Each POST carries
`x-policyvault-signature` (HMAC-SHA256 of the raw body with your endpoint
secret) and `x-policyvault-delivery` (dedupe id). Retries: 3 attempts with
backoff; inspect `GET /v1/guardian/webhooks/deliveries`.

### MCP

```bash
set POLICYVAULT_API_URL=http://localhost:8787
set POLICYVAULT_API_KEY=pv_agent_...
npm run dev:mcp
```

## Phase map

- **Now:** policy engine, double-entry ledger with revenue accounts, SQLite-backed API (durable, transactional, journal-replay reconciliation), guardian auth + rate limiting, signed webhooks with retries + test events, **real x402 client rail** (EIP-712 signing, exact-price settlement, dev facilitator), org EVM custody keys, policy editing API + UI, **insights engine** (period summary + ask-anything over your own data), **invoices & revenue** with payment score, **mission runs archive with generated deliverable documents**, Telegram approvals (set `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`), glass-design guardian console (overview, playground, work, approvals, invoices, escrows, ledger, policy, webhooks, activity, settings), escrow v0, HITL approvals, org/agent lifecycle, SDK/MCP tools, demo agent + demo paid API  
- **Next:** go-live on Base Sepolia (CDP custody + hosted facilitator + funded testnet wallet — needs a CDP API key); guardian login (Auth.js); hosted deploy  
- **Later:** Postgres swap (`store.ts` seam), KYT/screening, design partners, public metrics  
- **Optional (separate):** community token `ABINC` under [`contracts/`](./contracts/) — fixed-supply ERC-20 for Base; **not** wired into the console or agent USDC vaults. See `contracts/README.md`. 

## License

Private / all rights reserved until published.
