# ABI YC / Investor Demo — Audit, Plan, Script & Checklist

> Testnet / sandbox only. Never use real funds or production wallets.
> Do not display guardian or agent API keys on camera.

This pack is the repeatable demonstration for Artificial Banking Incorporated:
**policy-gated spend for autonomous agents**, with human approval when needed.

Validated against a live local stack on **2026-11-03** (Europe/Paris):

- `POST /v1/demo/bootstrap` → org **Maya Research Desk**
- Agent `pay_api` **$15** → `api.openai.com` → outcome **`review`** (`hitl_above`)
- Guardian `approvals/:id/resolve` `{ "approve": true }` → intent **`settled`**
- Ledger journals: `seed_demo_budget` → `hold_payment` → `finalize_payment`
- Research budget **$40 → $25**; vendor Insights show **$15** to `api.openai.com`

---

## 1. Application audit (demo readiness)

### Console navigation (`/console`)

| Group | Label | View | Demo role |
| --- | --- | --- | --- |
| Home | Overview | `overview` | Opening / closing shot |
| Home | Insights | `insights` | Financial visibility |
| Money | Treasury | `treasury` | Funding / vault |
| Money | Transactions | `payments` | Recent + approvals tab |
| Money | Ledger | `ledger` | Double-entry record |
| Connections | **API** | `agents` | Agents, groups, sessions (not a separate “Agents” nav item) |
| Connections | Work | `work` | Playground deliverables (optional) |
| Controls | Approvals | `approvals` | HITL inbox |
| Controls | Policies | `policy` | Caps, allowlists, HITL bands |
| Developers | Playground | `playground` | Guided agent scenarios |
| Developers | Webhooks | `webhooks` | Skip for core video |

Public developer docs: marketing `/docs` + `GET /v1/openapi.json` (not a console nav item).

### Feature readiness

| Capability | Status | Notes |
| --- | --- | --- |
| Deterministic policy engine | **Functional** | Caps, allow/blocklists, HITL, velocity, quiet hours |
| Human-in-the-loop approvals | **Functional** | Park → approve/deny → **policy re-check** → settle |
| Agent / groups / sessions | **Functional** | Under **API** tabs |
| Playground `approval` scenario | **Functional** | Needs testnet (`CHAIN=base-sepolia`) + training ≠ `0` |
| Ledger + Insights | **Functional** | Real APIs; empty until spend |
| Demo bootstrap | **Needs config** | `POLICYVAULT_ALLOW_BOOTSTRAP` (on by default outside production) |
| In-app faucet | **Incomplete** | External Circle / Base Sepolia faucets + Treasury Sync |
| On-chain USDC / x402 | **Needs external deps** | RPC, vault ETH+USDC, seller URL — optional encore |
| Managed custody (CDP) | **Not built** | Do not claim in the video |
| Login “Demo” button | **Gone** | README previously stale; use bootstrap script / curl |

### Honest demo constraints

1. Seed treasury is **$100 ledger float** ($60 org available + $40 Research), not on-chain USDC.
2. Vendor string pays (`api.openai.com`) settle on the **transfer-mock** ledger rail — perfect for HITL storytelling without faucet friction.
3. Approval TTL is ~**10 minutes** — do not leave a parked payment mid-pitch.
4. **Saving policy cancels pending approvals** — show Policies before Playground; do not Save while parked.
5. Pre-beta: not a bank, not FDIC insured, not production custody.

---

## 2. Business scenario

**Company:** Maya Research Desk  
**Budget / group:** Research  
**Agent:** Researcher (peer: Writer)  
**Vendor:** `api.openai.com` (allowlisted)  
**Purchase:** $15 bulk dataset / market-intel licence  

**Policy (seed defaults):**

- Allow under **$10**
- Human approval **$10–$25** (`hitlAboveUsdc=10`)
- Hard deny above **$25** (`perTxMaxUsdc=25`)
- Daily cap **$50**
- Allowlisted vendors only

**Story in one sentence:** An autonomous research agent can buy what it needs — but only through ABI, and anything above $10 waits for a human.

---

## 3. Page sequence (investor video)

| # | Step | Action | Expected result |
| --- | --- | --- | --- |
| 0 | Pre-warm | `npm run demo:bootstrap` (or curl) | Keys saved once, off-camera |
| 1 | Login | `/console` → Guardian key | Maya Research Desk loads |
| 2 | Overview | Show balances, agents, empty/pending queue | Org is live |
| 3 | Treasury → Fund | Vault address, Base Sepolia / testnet badge | Funding surface; note seed float vs faucet |
| 4 | Policies → Limits + Allowlists | Show $10 HITL, $25 ceiling, `api.openai.com` | **Do not Save** unless intentional |
| 5 | API → Agents | Researcher, Writer, status, budget | Agent identity |
| 6 | API → Groups | Research group | Shared controls |
| 7 | API → Sessions | Session keys / MCP URL if present | Scoped runtime credentials |
| 8 | Developer beat | Mention OpenAPI / agent Bearer APIs (≤10s) | Infrastructure, not only UI |
| 9 | Playground | Paste Researcher key → **Large purchase (needs your approval)** → Run | Parks at $15 (`hitl_above`) |
| 10 | Approvals | Open pending: agent, vendor, amount, rule | Policy gate visible |
| 11 | Approve | Resolve with Approve | Settles; agent resumes |
| 12 | Transactions | Recent completed $15 | End-to-end success |
| 13 | Ledger | `hold_payment` + `finalize_payment` (+ seed) | Auditable books |
| 14 | Insights | Vendors / Activity | Oversight |
| 15 | Overview | Final balances (~$25 Research) | Close |

**Skip:** invoices, escrow, batch, rails, Waitlist, Chat, seller console (unless a 15s encore).

**Primary scenario ID:** `approval` — *Large purchase (needs your approval)*.  
**Optional encore:** `redteam` — *Compromised agent* (deny).

---

## 4. Issues that can block the demo

| Issue | Mitigation |
| --- | --- |
| API/web not running | `npm run build` then `npm run dev` with `.env` from `.env.example` |
| Guided scenarios missing | `CHAIN=base-sepolia` so `org.network.testnet === true` |
| No Demo login button | Use `npm run demo:bootstrap` / `scripts/demo-bootstrap.mjs` |
| Approval expired | Re-run Playground scenario; keep park→approve under 10 min |
| Policy Save mid-park | Cancels pending — show policy first, save only if needed |
| Empty Insights | Run at least one settled payment first |
| Claiming CDP / production custody | Do not — self-custody keys encrypted in-process |

---

## 5. Recording script (~2:00–2:30)

Tone: founder showing the product. Short lines. Camera on the UI.

**0:00–0:12 — Hook (Overview)**  
“AI agents can already decide to buy things. ABI is the authorization layer between those agents and real money. This is Maya Research Desk — our agents share a Research budget under policy.”

**0:12–0:25 — Treasury**  
“Treasury holds the org float. On testnet you can fund the vault from an external faucet and sync deposits. For this walkthrough we’re on the seeded sandbox ledger so we can show the control loop cleanly.”

**0:25–0:45 — Policies**  
“Policy is deterministic — outside the model. Under ten dollars the agent can spend. Ten to twenty-five needs a human. Above twenty-five is denied. Only allowlisted vendors — here, api.openai.com.”

**0:45–1:00 — API / agents**  
“Researcher and Writer are agents with scoped credentials — keys never go in the prompt. They’re in the Research group on the shared budget. Developers hit the same engine over HTTP and MCP.”

**1:00–1:25 — Playground**  
“Researcher needs a fifteen-dollar dataset licence. Watch: it proposes the payment through ABI…”  
*(run scenario)*  
“…policy returns review. The agent is parked. It cannot approve itself.”

**1:25–1:45 — Approve**  
“Here’s the approval: agent, vendor, amount, rule `hitl_above`. I approve — ABI re-checks policy, then settles.”

**1:45–2:05 — Ledger + Insights**  
“Hold, then finalize — double-entry. Insights show spend by vendor. Finance can answer what the agents spent, on what, under whose approval.”

**2:05–2:20 — Close (Overview)**  
“Budget updated, approval clear, activity recorded. Agents get autonomy. The organization keeps financial control. That’s ABI.”

---

## 6. Recording checklist (operator)

### Day-of prep (off camera)

- [ ] Node ≥ 22.13
- [ ] `cp .env.example .env` — set `ABI_KEY_PEPPER`, `ABI_KEK`, `CHAIN=base-sepolia`, leave bootstrap allowed in development
- [ ] `npm install && npm run build`
- [ ] `npm run dev` → API `:8787`, console `:3000`
- [ ] `curl -s http://localhost:8787/health` → `ok`
- [ ] `npm run demo:bootstrap` → save `guardianKey` + `agentApiKey` once (password manager / local file — not in git)
- [ ] Open `/console`, paste guardian key, confirm **Maya Research Desk**
- [ ] Playground: paste Researcher `agentApiKey`
- [ ] Confirm Policies still show HITL $10 / ceiling $25 / vendor allowlist
- [ ] Browser zoom 110–125%, hide bookmarks, close unrelated tabs
- [ ] Dry-run once: Playground `approval` → Approvals → Approve → Ledger

### On camera

- [ ] Overview → Treasury Fund → Policies (no Save) → API agents/groups → Playground run → Approvals Approve → Transactions → Ledger → Insights → Overview
- [ ] Never show full API keys
- [ ] Never say “bank,” “FDIC,” or “Coinbase CDP custody”
- [ ] If anything fails, stop and re-bootstrap rather than faking success

### Recommended duration

- Core story: **2:00–2:30**
- With deny encore: **+20s**
- With live faucet sync: **+30–45s** (external browser)

---

## 7. Exact click path

1. Terminal: `npm run demo:bootstrap` (or `node scripts/demo-bootstrap.mjs`)
2. Browser: `http://localhost:3000/console`
3. Login → **Guardian key** → paste → continue
4. Sidebar **Overview**
5. Sidebar **Treasury** → tab **Fund**
6. Sidebar **Policies** → **Limits** then **Allowlists**
7. Sidebar **API** → Agents → Groups → Sessions
8. Sidebar **Playground** → select Researcher / paste agent key if needed → scenario **Large purchase (needs your approval)** → **Run**
9. When parked: banner **Approve** or sidebar **Approvals** → open row → **Approve**
10. Sidebar **Transactions** (recent)
11. Sidebar **Ledger**
12. Sidebar **Insights** → Vendors / Activity
13. Sidebar **Overview**

API equivalent (automation / CI dry-run):

```bash
# after bootstrap
curl -s -X POST "$API/v1/agent/pay_api" \
  -H "Authorization: Bearer $AGENT_KEY" -H "Content-Type: application/json" \
  -d '{"amountUsdc":"15","destination":"api.openai.com","memo":"bulk dataset licence","idempotencyKey":"'"$(uuidgen)"'"}'
# → 202 review + approvalId

curl -s -X POST "$API/v1/guardian/approvals/$APPROVAL_ID/resolve" \
  -H "Authorization: Bearer $GUARDIAN_KEY" -H "Content-Type: application/json" \
  -d '{"approve":true}'
# → settled; journals hold_payment + finalize_payment
```

---

## 8. What this proves to investors

1. Agents can initiate spend without holding keys.
2. Policy is deterministic and outside the model.
3. Over-threshold spend requires a human; agents cannot self-approve.
4. Approval does not waive hard limits (re-check on execute).
5. Settled activity is ledgered and visible in Insights (open **Vendors** / **Activity** tabs — P&L stays empty until Playground missions bill work).
6. The same path is available to developers via HTTP/MCP — ABI is infrastructure, not only a dashboard.

---

## 9. Helper commands

| Command | Purpose |
| --- | --- |
| `npm run demo:bootstrap` | Seed Maya Research Desk; write gitignored keys |
| `npm run demo:hitl-dry-run` | API-only park → approve → ledger/vendor assert |
| `node scripts/demo-capture-console.mjs` | Headless console screenshots + video (needs Playwright) |
| `node scripts/demo-capture-extras.mjs` | Groups, Sessions, Allowlists, Insights Vendors/Activity |
| `node scripts/demo-record-full-walkthrough.mjs` | Full investor video: marketing → sign-in → Insights/Treasury/Transactions/Policies → Circle faucet → Playground HITL → Approvals → Work (skips Ledger, API keys, Batch, Rails) |

Full walkthrough prerequisites: `npm run dev`, Playwright under `/tmp/pw`, and email/password + agent key in `/tmp/abi-full-demo-creds.json`. Outputs `abi-full-investor-demo.mp4` (+ stills) under `/opt/cursor/artifacts/` during agent sessions (not committed). Circle faucet fill is shown; reCAPTCHA may block live USDC credit — demo ledger float still funds the HITL story.
