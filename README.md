<div align="center">

# Artificial Banking Incorporated

**The authorization layer between AI agents and real money.**

Policy-gated USDC wallets for autonomous agents. The model proposes a payment.
A deterministic policy engine authorizes it. A human approves anything large.
Keys never enter the prompt.

[![CI](https://github.com/MOMOEXPRESS/Artificial-Banking-Inc/actions/workflows/ci.yml/badge.svg)](https://github.com/MOMOEXPRESS/Artificial-Banking-Inc/actions/workflows/ci.yml)
![Node](https://img.shields.io/badge/node-%E2%89%A522.13-informational)
![Status](https://img.shields.io/badge/status-pre--beta-orange)
![License](https://img.shields.io/badge/license-proprietary-lightgrey)

_Not a bank. Not FDIC insured._

</div>

---

## Status — read this first

**ABI is pre-beta and is not safe to run against real customer funds.**

An independent audit in July 2026 found critical defects in persistence,
custody, and authentication. The [current next-build plan](docs/NEXT-BUILD-PLAN.md)
tracks the testnet proof and next product phases. The original engineering plan is
[`docs/ROADMAP.md`](docs/ROADMAP.md) and the audit is
[`docs/archive/2026-07-26-independent-audit.md`](docs/archive/2026-07-26-independent-audit.md).

This table is the honest maturity picture. It is maintained deliberately,
because a previous version of this README described capabilities that did not
exist.

| Capability                     | State                      | Notes                                                                                                                                                                                                                                           |
| ------------------------------ | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deterministic policy engine    | ✅ **Built**               | Caps, velocity, allow/blocklists, quiet hours, HITL bands, IF/THEN automation, versioning, replay simulator                                                                                                                                     |
| Double-entry ledger            | ✅ **Built**               | Balanced journals, no-negative asset accounts, cross-tenant guard, genesis-replay reconciliation                                                                                                                                                |
| Human-in-the-loop approvals    | ✅ **Built**               | Park → notify → quorum → atomic claim → **policy re-check** → execute                                                                                                                                                                           |
| Agent lifecycle                | ✅ **Built**               | Create, profile, group, scoped session keys, freeze, archive, rotate, revoke                                                                                                                                                                    |
| Escrow between agents          | ✅ **Built**               | Lock, release, refund, timeout auto-refund                                                                                                                                                                                                      |
| Signed webhooks                | ✅ **Built**               | HMAC-SHA256, rotatable secret, delivery dedupe, SSRF-guarded                                                                                                                                                                                    |
| Real Base USDC transfers       | ✅ **Built**               | Genuine ERC-20 `transfer` from the org vault, verifiable on Basescan                                                                                                                                                                            |
| Guardian console               | ✅ **Built**               | Treasury, agents, payments, policy, insights, playground, audit                                                                                                                                                                                 |
| MCP server + TypeScript SDK    | ✅ **Built**               | SDK package is publication-ready; npm release still requires registry credentials                                                                                                                                                               |
| Per-agent programmable budgets | ✅ **Built**               | Policy layers org → agent: per-agent caps, thresholds and allowlists, with provenance showing which layer applied. Org-wide daily ceiling too                                                                                                   |
| **x402 payments**              | ✅ **Base Sepolia proven** | Buyer and seller speak x402 V2 through the official SDK. A real facilitator settled `0.01` test USDC on Base Sepolia and ABI persisted the authentic transaction hash. See [`docs/X402-BASE-SEPOLIA-PROOF.md`](docs/X402-BASE-SEPOLIA-PROOF.md) |
| **Treasury**                   | 🚧 **Partial**             | On-chain deposit detection is real; manual "receive/send" is ledger-only                                                                                                                                                                        |
| Durable persistence            | ✅ **Fixed**               | Persistent API process, real transactions. Postgres is next for horizontal scale ([ADR](docs/adr/2026-07-26-persistent-api-over-serverless.md))                                                                                                 |
| Background jobs                | ✅ **Fixed**               | Subscriptions, escrow timeouts, approval expiry and reconcile now actually run, with leases so scaling cannot double-charge                                                                                                                     |
| Authentication                 | ✅ **Built**               | Accounts, hashed passwords, httpOnly sessions + CSRF, memberships, invitations, TOTP MFA, step-up on large approvals, password reset. SSO/SAML still ahead                                                                                      |
| **Managed custody**            | ❌ **Not built**           | Self-custody. Keys are now encrypted at rest and serialised per vault, but they still live in this process — CDP/MPC is the real fix                                                                                                            |
| **Compliance screening**       | ❌ **Not built**           | Extension point exists; no OFAC/KYT data source behind it                                                                                                                                                                                       |
| Destructive endpoints          | ✅ **Removed**             | Demo seeding no longer wipes tenants; the global reset is a local script                                                                                                                                                                        |
| **Python SDK**                 | ❌ **Not built**           | TypeScript only                                                                                                                                                                                                                                 |
| ERC-4337 / account abstraction | ❌ **Not scoped**          | —                                                                                                                                                                                                                                               |

---

## The problem

An AI agent can now decide to buy something. Nothing stops it from being wrong.

The usual answers are both bad. Give the agent a card and you have handed an
unpredictable process unbounded authority. Put a human in front of every action
and you have deleted the reason to use an agent at all.

ABI is the third answer: give the agent a wallet whose limits are enforced
outside the model. The agent asks. Deterministic rules decide. Anything past
your threshold waits for a person. Every outcome — allowed, held, denied — lands
in one auditable ledger with the exact rule that fired.

> **LLM proposes. Policy authorizes. Keys never enter the model.**

### Who it is for

- Teams running agents that pay for APIs, data, compute, or other agents
- Finance functions that need spend controls before they will approve autonomy
- Anyone who needs to answer "what did the agents spend, on what, under whose approval?"

---

## How it works

```
                 ┌──────────────────────────────────────────────┐
   AI agent      │  ABI                                         │
   ─────────►    │                                              │
   "pay $12 to   │   1. Policy engine  ──► allow / review / deny│
    api.foo.com" │   2. Ledger hold                             │
                 │   3. Human approval  (if review)             │
                 │   4. Rail settles    (x402 · Base USDC)      │
                 │   5. Finalize + release unspent remainder    │
                 │   6. Journal · receipt · webhook             │
                 └──────────────────────────────────────────────┘
                                    │
                          Guardian console · audit
```

Three outcomes, always explained:

| Outcome    | What happens                                                                   |
| ---------- | ------------------------------------------------------------------------------ |
| **allow**  | Funds held, rail settles, exact charge booked, remainder released              |
| **review** | Payment parks; guardian notified; agent polls; **policy re-runs at execution** |
| **deny**   | Nothing moves; the rule that fired is recorded on the decision                 |

The re-check on approval matters more than it looks. A guardian's approval
satisfies the human-in-the-loop rule — it does not waive caps, freezes, or the
blocklist. Without it, a queue of individually-legal approvals can collectively
blow the daily limit.

---

## Architecture

```
apps/
  api/           Guardian + agent HTTP API — policy, ledger, rails, engine
  web/           Guardian console + marketing site (Next.js 15, App Router)
  mcp-server/    MCP tools so Claude / LangGraph / Eliza runtimes can spend
  worker/        Background jobs (stub — becomes the job runner in P2-T3)
  demo-agent/    Runnable example: budget → simulate → pay → denied → HITL → escrow
  x402-seller/   x402 V2 paid API; real facilitator settlement

packages/
  common/        Money types (micro-USDC bigint), error codes, account ids
  policy/        Deterministic policy engine — no I/O, fully unit tested
  ledger/        Double-entry primitives: hold, finalize, release, escrow
  custody/       CustodyProvider interface — the only place keys are touched
  sdk/           TypeScript agent + guardian client
  db/            Prisma schema, staged for the Postgres migration (P2-T2)

contracts/       ABINC community token (ERC-20, Base) — NOT wired to the product
archive/         Reference code, excluded from build and CI
```

### Extension seams

The interfaces below exist so the corresponding implementations can be swapped
without touching the engine. Several are currently backed by development
implementations — that is the honest state, and each is a roadmap item.

| Seam          | Interface            | Today                          | Next                                         |
| ------------- | -------------------- | ------------------------------ | -------------------------------------------- |
| Custody       | `CustodyProvider`    | Self-custody, local key        | Coinbase CDP Server Wallets (P4-T1)          |
| Payment rails | `PaymentRail`        | x402 V2 · Base ERC-20 · mock   | Funded public proof + production facilitator |
| Compliance    | `ComplianceScreener` | Env denylist                   | Chainalysis / TRM / OFAC (P11-T1)            |
| Storage       | `store.ts`           | SQLite                         | Postgres (P2-T2)                             |
| Notifications | `registerNotifier`   | in-app, Telegram, Slack, email | —                                            |
| Observability | `ObservabilitySink`  | Prometheus text                | Real monitoring (P12-T1)                     |

Full detail: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Technology

| Layer      | Choice                     | Why                                                          |
| ---------- | -------------------------- | ------------------------------------------------------------ |
| Language   | TypeScript (strict, ESM)   | One language across API, web, SDK, agents                    |
| API        | Express 4                  | Small surface; the value is in the domain, not the framework |
| Web        | Next.js 15 · React 19      | App Router, Tailwind, Radix primitives                       |
| Money      | `bigint` micro-USDC        | Floating point has no place in a ledger                      |
| Chain      | viem · Base / Base Sepolia | USDC settlement, EIP-712 signing                             |
| Storage    | better-sqlite3 → Postgres  | All SQL behind one module, so the swap is contained          |
| Validation | Zod                        | Every request body parsed at the boundary                    |
| Tests      | `node:test`                | No runner dependency                                         |

---

## Quick start

**Requires Node 22.13+.**

```bash
git clone https://github.com/MOMOEXPRESS/Artificial-Banking-Inc.git
cd Artificial-Banking-Inc
npm install
npm run build
npm test
```

Start the API and the console in two terminals:

```bash
npm run dev:api
```

```bash
npm run dev:web
```

Open <http://localhost:3000/console>, choose **Demo**, and save the keys it shows
you once.

### Walk the money path

1. **Agent pay $1.20** — allowed, settles, receipt
2. **Agent pay $15** — parks in the Approvals inbox; approve and the agent resumes
3. **Simulate drain** — `POLICY_DENIED`, with the rule that fired
4. **Escrow $5 → Writer** — locks funds; release pays, refund returns, timeout auto-refunds
5. **Freeze agent** — kill switch; further pays deny with an `agent_frozen` trace

Default demo bands: allow under **$10** · guardian approval **$10–$25** · hard
deny at **$25** · daily cap **$50** · 10 payments/minute · allowlist-only
destinations · unknown counterparties go to review.

### Try x402 locally

```bash
X402_SELLER_ADDRESS=0xYourBaseSepoliaWallet \
X402_FACILITATOR_URL=https://x402.org/facilitator \
npm run dev -w @policyvault/x402-seller
```

```bash
curl -s -X POST http://localhost:8787/v1/guardian/policy \
  -H "Authorization: Bearer pv_guardian_..." -H "Content-Type: application/json" \
  -d '{"domainAllowlist":["localhost"]}'
```

```bash
curl -s -X POST http://localhost:8787/v1/agent/pay_api \
  -H "Authorization: Bearer pv_agent_..." -H "Content-Type: application/json" \
  -d '{"amountUsdc":"2","destination":"http://localhost:9402/report","idempotencyKey":"try_x402_1"}'
```

The seller uses x402 V2 (`eip155:84532`) and delegates verification and
settlement to the configured facilitator. ABI books the payment only when the
seller returns a successful `PAYMENT-RESPONSE` with a 32-byte transaction hash.
Follow [`docs/X402-BASE-SEPOLIA-PROOF.md`](docs/X402-BASE-SEPOLIA-PROOF.md) for
the funded proof and BaseScan checks.

---

## Connecting an agent

An agent is an HTTP client with a bearer key. It never touches keys or the
vault — it calls money verbs and the policy engine decides.

```bash
curl -s -X POST http://localhost:8787/v1/guardian/orgs \
  -H "Content-Type: application/json" -d '{"name":"Acme Agent Co"}'
```

```bash
curl -s -X POST http://localhost:8787/v1/guardian/agents \
  -H "Authorization: Bearer pv_guardian_..." \
  -H "Content-Type: application/json" -d '{"name":"Analyst"}'
```

```bash
curl -s -X POST http://localhost:8787/v1/guardian/allocate \
  -H "Authorization: Bearer pv_guardian_..." \
  -H "Content-Type: application/json" \
  -d '{"agentId":"agt_...","amountUsdc":"30"}'
```

```bash
curl -s http://localhost:8787/v1/agent/budget \
  -H "Authorization: Bearer pv_agent_..."
```

Three integration surfaces, one key:

- **REST** — the calls above; OpenAPI at `GET /v1/openapi.json`
- **TypeScript SDK** — `new PolicyVaultClient({ baseUrl, apiKey })`
- **MCP** — `apps/mcp-server` exposes the verbs as tools for agent runtimes

A full runnable loop lives in `apps/demo-agent`:

```bash
POLICYVAULT_API_KEY=pv_agent_... npm run demo:agent
```

> `packages/sdk` is now publishable and includes x402 receipt and merchant
> onboarding examples. The first npm release still requires an owner of the
> `@policyvault` scope to run `npm publish`; there is no Python SDK yet.

### Agent endpoints

`GET /v1/agent/budget` · `POST /v1/agent/simulate` · `POST /v1/agent/pay` ·
`POST /v1/agent/pay_api` · `POST /v1/agent/escrow/lock` ·
`GET|POST /v1/agent/escrow/:id[/release|refund]` ·
`GET /v1/agent/approvals/:id` (poll after a `202 NEEDS_APPROVAL`) ·
`GET /v1/agent/activity` · `GET /v1/agent/decisions/:intentId`

Guardian routes are under `/v1/guardian/*` and always derive the organization
from the key, never from the request.

---

## Environment

Copy `.env.example` and adjust. Every variable, with what happens if it is unset:

| Variable                                                     | Default                          | Required in production       | Effect                                                                                                      |
| ------------------------------------------------------------ | -------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `PORT`                                                       | `8787`                           | no                           | API port                                                                                                    |
| `POLICYVAULT_DB`                                             | `./apps/api/data/policyvault.db` | no                           | SQLite path                                                                                                 |
| `ABI_KEY_PEPPER`                                             | _dev fallback only_              | **yes**                      | Salt for API-key hashing. Production **refuses to boot** without it                                         |
| `NEXT_PUBLIC_API_URL`                                        | `/abi-api`                       | no                           | Console → API origin                                                                                        |
| `POLICYVAULT_ALLOW_BOOTSTRAP`                                | on outside production            | **set to `0`**               | Enables demo-org seeding. No longer destructive, but it mints a root key                                    |
| `POLICYVAULT_ALLOW_PUBLIC_ORG_CREATE`                        | on outside production            | **set to `0`**               | Self-serve org creation                                                                                     |
| `ABI_SIGNUP_TOKEN`                                           | —                                | **yes** (if the above is on) | Required header `x-abi-signup-token` for org creation / demo seeding                                        |
| `ABI_SIGNUP_LIMIT_PER_HOUR`                                  | `10`                             | no                           | Per-IP cap on credential-minting routes                                                                     |
| `ABI_ALLOW_LOCAL_TARGETS`                                    | on outside production            | **set to `0`**               | Permits outbound fetches to loopback/private addresses (local x402 seller)                                  |
| `CHAIN`                                                      | `base-sepolia`                   | no                           | `base` or `base-sepolia`                                                                                    |
| `X402_FACILITATOR_URL`                                       | `https://x402.org/facilitator`   | seller only                  | Facilitator used by the x402 seller; public endpoint is for testnet proof                                   |
| `X402_SELLER_ADDRESS`                                        | —                                | seller only, **yes**         | Base wallet receiving seller USDC; seller refuses to boot without it                                        |
| `X402_PRICE_USDC`                                            | `$0.01`                          | no                           | Demo seller route price                                                                                     |
| `CHAIN_RPC_URL`                                              | public RPC                       | recommended                  | Use a paid RPC; public endpoints rate-limit                                                                 |
| `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET`                      | —                                | no                           | Selects production-mode custody. **Does not enable Coinbase custody** — see [SECURITY.md](docs/SECURITY.md) |
| `OPENAI_API_KEY`                                             | —                                | no                           | Enables the console assistant. **Sends org financial data to OpenAI** (P8-T2)                               |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID`                    | —                                | no                           | Approve from Telegram                                                                                       |
| `SLACK_WEBHOOK_URL`, `RESEND_API_KEY`, `ABI_NOTIFY_EMAIL_TO` | —                                | no                           | Notification channels; log a stub when unset                                                                |
| `ABI_COMPLIANCE_DENYLIST`                                    | empty                            | no                           | Comma-separated denied destinations                                                                         |
| `ABI_COMPLIANCE_FAIL_CLOSED`                                 | off                              | **yes**                      | Block rather than allow when a screener errors                                                              |
| `RATE_LIMIT_PER_MIN`                                         | `5000`                           | no                           | Abuse protection, not throttling                                                                            |
| `APPROVAL_TTL_MINUTES`                                       | `10`                             | no                           | How long a parked payment waits                                                                             |

---

## Development

```bash
npm run build
npm run typecheck
npm run lint
npm test
```

CI runs all four on every push and pull request. See
[`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md) for conventions and the extra
review rules that apply to money-path code.

---

## Deployment

Docker Compose and a Dockerfile are included:

```bash
docker compose up
```

This brings up three processes sharing one volume: `api` (persistent HTTP
service, owns the database), `worker` (background sweeps), and `web` (console,
proxying `/abi-api` to the API). Set `ABI_KEY_PEPPER` first — the API refuses to
boot in production without it.

> **Still not ready for real customer funds.** Persistence and background jobs
> are fixed, but there is no authentication system and vault keys are held
> unencrypted by the application (roadmap Phases 3–4). Keep any deployment
> behind access control.

Details: [`docs/DEPLOY.md`](docs/DEPLOY.md).

---

## Screenshots

<!-- Placeholders. Replace with real captures once the console settles after Phase 9. -->

|                                                             |                                                                |
| ----------------------------------------------------------- | -------------------------------------------------------------- |
| `docs/assets/screenshot-overview.png`                       | `docs/assets/screenshot-approvals.png`                         |
| **Overview** — vault, agents, live activity                 | **Approvals** — parked payments awaiting a person              |
| `docs/assets/screenshot-policy.png`                         | `docs/assets/screenshot-playground.png`                        |
| **Policy** — replay real history against unsaved rule edits | **Playground** — a real agent spending through the real engine |

---

## Roadmap

Full plan with dependencies, complexity and priority:
[`docs/ROADMAP.md`](docs/ROADMAP.md).

| Phase    | Focus                                                 |
| -------- | ----------------------------------------------------- |
| **0**    | Repository hygiene, CI, truthful claims ← _current_   |
| **1**    | Remove destructive endpoints and fund-loss paths      |
| **2**    | Persistent API + Postgres; restore background jobs    |
| **3**    | Authentication, sessions, roles, recovery             |
| **4**    | Managed custody, key encryption, gas                  |
| **5**    | Settlement correctness; real x402                     |
| **6**    | Per-agent programmable budgets                        |
| **7**    | Treasury integrity + on-chain reconciliation          |
| **8**    | Agent depth and runtime adapters — **beta gate**      |
| **9–12** | UX, SDKs, compliance, launch — **public launch gate** |

---

## Documentation

| Document                                         | Purpose                                                               |
| ------------------------------------------------ | --------------------------------------------------------------------- |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)   | System design and extension points                                    |
| [`docs/ROADMAP.md`](docs/ROADMAP.md)             | Phased plan, dependencies, beta/launch gates                          |
| [`docs/SECURITY.md`](docs/SECURITY.md)           | Actual posture, enforced guarantees, disclosure                       |
| [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md)   | Setup, conventions, money-path review rules                           |
| [`docs/DEPLOY.md`](docs/DEPLOY.md)               | Deployment and go-live                                                |
| [`docs/OWNER-ACTIONS.md`](docs/OWNER-ACTIONS.md) | Work blocked on the repo owner: secrets, funding, legal, verification |
| [`docs/adr/`](docs/adr/)                         | Decision records                                                      |
| [`docs/strategy/`](docs/strategy/)               | Positioning, GTM, fundraising                                         |
| [`docs/archive/`](docs/archive/)                 | Dated, point-in-time documents — not maintained                       |

---

## Contributing

See [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md). In short: branch, make CI
green, one clean commit, open a PR. Changes to the policy engine, ledger,
custody, or rails need a second reviewer and a test.

## Security

Do not open a public issue for an exploitable defect — see
[`docs/SECURITY.md`](docs/SECURITY.md), which also states the current posture
plainly, including what is not yet protected.

## License

Proprietary. All rights reserved pending a licensing decision (roadmap P12-T5).

---

<div align="center">
<sub>Not a bank. Not FDIC insured. Nothing here is financial advice.</sub>
</div>
