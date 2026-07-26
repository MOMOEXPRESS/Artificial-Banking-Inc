# ABI Full System Review

> **Archived — point-in-time.** Written July 2026. Kept for history; it is not a
> description of the current system and is not maintained. The living documents
> are [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) and
> [`docs/ROADMAP.md`](../ROADMAP.md).

**Date:** 2026-07-20  
**Product:** Artificial Banking Incorporated (PolicyVault) — Financial OS for AI agents  
**Hard rule:** LLM proposes → policy + signer authorize → keys never enter the model  
**Environment probed:** Live API `:8787` + unit tests + OpenAPI catalog (103 paths / 118 ops)  
**Branch context:** `cursor/console-ux-audit-1ad2` (includes prior gap-closure + UX audit)

---

## 1. Executive verdict

| Dimension | Score (1–10) | Grade | One-line |
|-----------|--------------|-------|----------|
| **Money spine correctness** | 9.0 | A | Deterministic policy → ledger → rails is coherent and tested on core paths |
| **Feature completeness (13 pillars MVP)** | 8.5 | A− | All 13 marked COMPLETE for MVP; deferred items are intentional, not forgotten |
| **User interaction / interactability** | 7.5 | B+ | Almost every capability is reachable; some discoverability/polish gaps remain |
| **User flow (job-to-outcome)** | 7.0 | B | Happy paths work; funding + groups were weak until UX pass; still dual money APIs |
| **UI design (screens)** | 7.0 | B | Overview/Policy/Playground strong; Treasury improved; Agents load *feels* slow despite fast API |
| **UI system (tokens, patterns, consistency)** | 6.5 | B− | Shared cards/pills/grids exist; mixed `panel` vs `card`, prompt() for group fund |
| **Performance (API)** | 9.0 | A | Agents/groups ~13ms; stress ~700–2900 rps; 0 probe failures |
| **Performance (Console perceived)** | 6.0 | C+ | Shell polls 14 endpoints; Agents remounts 4 fetches; Next cold start dominates |
| **Operational readiness (prod bank-grade)** | 5.0 | C | DevLocal custody, mock deposit, plaintext keys (A13), SQLite — correct for MVP, not bank |

**Bottom line:** The system **runs properly** for its stated purpose (policy-gated agent treasuries on mock/dev rails). It is **not** a live bank or CDP-settled product yet. Of the 13 pillars, **MVP surfaces are done**; what remains is **depth** (live custody, hashed keys, Postgres, richer commerce) plus **Console polish/perf**.

---

## 2. How the system works (money spine)

```
Guardian Console / Chat / Telegram          Agent SDK / MCP / Playground
                 │                                    │
                 ▼                                    ▼
            authGuardian (pv_guardian_…)      authAgent (pv_agent_… / pv_sess_…)
                 │                                    │
                 └──────────── apps/api ──────────────┘
                                    │
         handleIntent → evaluatePolicy (@policyvault/policy)
              │ allow | deny | review
              │ (+ automation: notify / require_approval / deny / freeze_agent)
              ▼
         executeIntent
              → compliance.screenDestination
              → ledger hold (micro-USDC double-entry)
              → PaymentRail.settle (x402 | transfer-mock)
              → CustodyProvider.signTypedData (DevLocal today; CDP stub ready)
              → finalize + webhooks + notifier + ObservabilitySink
```

**Persistence:** `apps/api/src/store.ts` (SQLite). Prisma in `packages/db` is aspirational (A14 deferred).

**Reaction model (every money action):**

| Policy outcome | Immediate reaction | Deliverable / artifact |
|----------------|--------------------|------------------------|
| **allow** | Intent executes; journal lines post; webhook `payment.succeeded` (etc.) | Receipt / escrow row / decision `allow` |
| **deny** | HTTP 4xx `POLICY_DENIED`; no ledger move | Decision with `ruleIds` + reasons |
| **review** | Approval parked; agent blocked; Chat/Telegram/banner alert | Approval row; after resolve → execute or deny |

---

## 3. Live verification (this review)

### 3.1 Unit tests
- `@policyvault/policy` — pass  
- `@policyvault/ledger` — pass  
- `@policyvault/api` `claimEscrow` CAS — pass  

### 3.2 Action matrix (live API after demo bootstrap)

**49/50 checks green.** The one “FAIL” was `POST /v1/agent/pay` to an unallowlisted address returning **403 POLICY_DENIED** — that is the **correct** security reaction (re-checked as pass).

Covered live: org, agents, detail, wallets, policy, activity, metrics, approvals, escrows, invoices, subscriptions, webhooks, rails, payments/recent, cashflow, forecast, recovery, compliance, observability, merchants, settings, guardians, freezes, chat, burn, anomalies, economics, vendors, setup, OpenAPI, agent budget/activity/simulate/pay_api, deposit, allocate, group create/assign/fund/freeze/unfreeze, escrow lock/get/refund, webhook create/rotate/delete, invoice create, drain correctly denied.

### 3.3 Latency (why Agents/Groups felt slow)

| Probe | Result |
|-------|--------|
| `GET /agents` | **~13–14 ms** |
| `GET /agent-groups` | **~12–13 ms** |
| Agents page 4-way parallel (agents+groups+freezes+sessions) | **~4.5–16 ms** |
| Console fast tier (org+approvals+activity+escrows) parallel | **~96 ms** |
| Stress (8×5): org ~729 rps, budget ~2128 rps, simulate ~1090 rps, activity ~2962 rps | **0 failures** |

**Conclusion:** Backend is not the bottleneck. Perceived slowness comes from:

1. **Console shell** `refreshFast` every **4s** + `refreshSlow` every **15s** (up to **14 endpoints**).  
2. **Agents view** fires 4 fetches on mount, then **detail + analytics** on select; **create group** calls `refresh()` which reloads all 4 again.  
3. **Next.js** cold compile / hydration on first visit.  
4. After every mutation, `act()` → `refreshAll()` (fast+slow) — whole console reloads.

---

## 4. Complete action catalog

Legend: **G** = Guardian Console · **A** = Agent SDK/MCP · **S** = System/worker · **Rx** = reaction · **Out** = result artifact

### 4.1 Identity & org

| Action | Who | API | Rx | Out |
|--------|-----|-----|----|-----|
| Demo bootstrap | Dev | `POST /v1/demo/bootstrap` | Wipe+seed Maya org | guardianKey, agent keys, $100 vault |
| Create org | Gated | `POST /v1/guardian/orgs` | Ledger seed deposit | org + founding guardian key |
| View org | G | `GET /v1/guardian/org` | — | balances, agents, actor role |
| Freeze / unfreeze org | G owner | `POST .../freeze|unfreeze` | All spends deny | freeze audit + webhooks |
| Invite guardian | G owner | `POST .../guardians` | Role approver/viewer | key shown once |
| Revoke guardian | G owner | `DELETE .../guardians/:id` | Key dead | — |
| Set quorum | G | `POST .../quorum` | HITL needs N votes | policy.approvalQuorum |
| Org settings | G | `GET\|PATCH .../settings` | Merge JSON | plan/SSO flags etc. |

### 4.2 Treasury

| Action | Who | API | Rx | Out |
|--------|-----|-----|----|-----|
| List wallets | G | `GET .../wallets` | — | org/dept/agent/shared |
| Deposit (demo) | G owner | `POST .../treasury/deposit` | +org_available −external | journal |
| Withdraw | G owner | `POST .../treasury/withdraw` | −org +external | journal |
| Allocate stipend | G | `POST .../allocate` *or* `wallets/move` | org→agent | journal |
| Reclaim | G | `POST .../reclaim` | agent→org (available only) | journal |
| Transfer agent↔agent | G | `POST .../transfer` | balanced journal | journal |
| Unified move | G | `POST .../wallets/move` | allow or park multisig | move row / executed |
| Approve pending move | G | `POST .../treasury/moves/:id/resolve` | votes→execute | move executed |
| Create department | G | `POST .../departments` | empty dept wallet | dept row |
| Create shared wallet | G | `POST .../shared-wallets` | pool + members | wallet |
| Cashflow / forecast | G | `GET .../cashflow` `/forecast` | — | series + runway |
| Rotate vault key | G | `POST .../recovery/rotate-vault` | new address | recovery log |

### 4.3 Agents

| Action | Who | API | Rx | Out |
|--------|-----|-----|----|-----|
| Create agent | G | `POST .../agents` | wallets + apiKey | key once + playground |
| List / detail | G | `GET .../agents` `.../:id` | — | profile, decisions, runs |
| Patch profile | G | `PATCH .../agents/:id` | tags/runtime/group/owner | identity |
| Freeze / unfreeze | G | `POST .../freeze|unfreeze` | spend deny / resume | freeze log |
| Archive / unarchive | G | `POST .../archive|unarchive` | non-spendable; keys dead | status |
| Rotate / revoke key | G | `POST .../rotate-key` `revoke-key` | old key dead | new key / sessions revoked |
| Session key mint | G | `POST .../session-keys` | `pv_sess_…` | scoped token |
| Create group | G | `POST .../agent-groups` | desk label | group |
| Assign members | G | `POST .../agent-groups/:id/assign` | profile.groupId | membership |
| Fund group | G | `POST .../agent-groups/:id/fund` | equal allocate each | journals |
| Freeze / unfreeze desk | G | `POST .../freeze|unfreeze` on group | all members frozen | freeze events |
| Analytics | G | `GET .../agents/:id/analytics` | — | lifetime settled etc. |

### 4.4 Policy

| Action | Who | API | Rx | Out |
|--------|-----|-----|----|-----|
| Get / update policy | G | `GET\|POST .../policy` | new version snapshot | PolicyTemplate |
| Simulate | G/A | `POST .../simulate` or agent simulate | dry-run outcome | decision preview |
| Restore version | G | `POST .../policy/versions/:id/restore` | rules roll back | version row |
| Apply template | G | `POST .../policy/templates/:id/apply` | Solo/Swarm/Seller | policy |
| Automation rules | G | via policy update | IF→THEN on intents | side-effects |

**Engine rules that fire (logic):** per-tx max, daily max, velocity, allowlists, blocklist, cooldown, quiet hours, HITL amount/categories, freeze flags, automation matches.

### 4.5 Agent money verbs (SDK / MCP / Playground)

| Action | Tool / route | Rx | Out |
|--------|--------------|----|-----|
| Budget | `get_budget` | — | available/held/dailyRemaining |
| Simulate | `simulate_payment` | policy only | outcome |
| Pay address | `pay` | spine | deny / review / receipt |
| Pay API (x402) | `pay_api` | 402 dance + settle | resource + receipt |
| Escrow lock/status/release/refund | escrow_* | hold / settle / refund | escrow state |
| Poll / wait approval | `get_approval` / `wait_for_approval` | status flip | approval |
| Activity / decision | `list_activity` / `get_decision` | — | decisions |

### 4.6 Payments commerce

| Action | Who | Rx | Out |
|--------|-----|----|-----|
| Invoice create/pay/void | G | pay books revenue to treasury | invoice |
| Escrow guardian resolve | G | release/refund | escrow terminal state |
| Schedule one-shot | G | creates sub-like run | scheduled row |
| Batch ≤10 | G | enqueue | created/errors |
| Subscription CRUD | G | sweeper charges under policy | sub status |
| Rails registry | G | — | x402 + transfer-mock |

### 4.7 Approvals, chat, insights, webhooks, audit

| Action | Rx | Out |
|--------|----|-----|
| Resolve approval | continue execute or deny | payment or denial |
| Chat ask | deterministic facts (+ optional rephraser) | message |
| Insights burn/anomalies/economics | read models | charts/panels |
| Webhook register/test/rotate/delete | HMAC deliveries + retries | secret once; delivery log |
| Audit export JSON/CSV | — | downloadable trail |
| Playground missions (7) | real agent API steps | run + markdown deliverable |

---

## 5. Scoring detail

### 5.1 User interaction (7.5 / 10)

**Strengths:** Almost every backend capability has a Console or MCP surface; viewer role disables mutates; PageTours explain pages; Playground makes the spine tangible.

**Weaknesses:** Group fund uses `window.prompt`; dual allocate vs wallets/move; Settings “recurring” is a redirect stub; Chat polls every 4s.

### 5.2 User flows (7.0 / 10)

| Flow | Score | Notes |
|------|-------|-------|
| Bootstrap → fund agent → mission | 8.5 | Works end-to-end |
| HITL park → approve → resume | 9.0 | Best demo of product |
| Red-team drain denied | 9.5 | Correct deny with rule ids |
| Deposit → withdraw story | 7.5 | Clear after Fund tab; still mock |
| Desk freeze / fund group | 8.0 | Now real; UI still rough |
| Invoice → treasury revenue | 7.0 | Works; easy to miss under Payments |
| Go-live CDP | 4.0 | Setup checklist honest; not wired |

### 5.3 UI design (7.0 / 10)

Overview composition improved (Agents ‖ Move funds). Policy/Playground/Insights read well. Agents profile spacing improved. Treasury Fund-first is usable. Remaining: density on Agents roster, prompt dialogs, some empty states still generic.

### 5.4 UI system (6.5 / 10)

Shared: `card`, `pill`, `seg`, `grid g-*`, `Stat`, `Empty`, `banner`. Inconsistent: older `panel`/`stat-grid` remnants were removed from Treasury but patterns still diverge across views; no design-token package; motion limited.

---

## 6. Thirteen pillars — done / partial / missing

Interpretation: **DONE** = MVP surface ships and works. **PARTIAL** = API/UI exists but depth or polish incomplete. **MISSING/DEFERRED** = intentional non-goals or blocked.

| # | Pillar | MVP status | Partial / missing depth | Priority to deepen |
|---|--------|------------|-------------------------|--------------------|
| 1 | **Treasury** | **DONE** | Live deposit indexer; on-chain withdraw; multi-asset | High for go-live |
| 2 | **AI Agent Management** | **DONE** | Group fund UX; batch ops; reputation | Med |
| 3 | **Financial Policies** | **DONE** | Visual IF/THEN; richer simulator history | Med |
| 4 | **Payments** | **DONE** | Usage metering; more rails; live facilitator | High |
| 5 | **Observability** | **DONE** | OTel/Prometheus sink | Med |
| 6 | **Security** | **DONE** | **A13 key hashing**; session UX | **High** |
| 7 | **AI Features** | **DONE** | LLM policy authoring = deferred non-goal | Low |
| 8 | **Developer Platform** | **DONE** | Multi-lang SDKs from OpenAPI | Med |
| 9 | **Enterprise** | **DONE** | SSO/SCIM | Med (enterprise sales) |
| 10 | **Ecosystem** | **DONE** | Marketplace = deferred | Low |
| 11 | **Notifications** | **DONE** | Real email/Slack SMTP; Discord/SMS | Med |
| 12 | **Automation** | **DONE** | Visual builder | Low until versioning used |
| 13 | **Compliance** | **DONE** | Full KYC/AML vendors | High for regulated |

**Answer to “is there still stuff on the 13 pillars?”**  
For **MVP completeness: no — all 13 have working surfaces.**  
For **production depth: yes** — mainly live custody/settlement, key hashing, Postgres, real notifiers, and KYC vendors.

**Sub-capability matrix + feature brainstorm:** see [`docs/PILLAR-DEPTH-AUDIT.md`](./PILLAR-DEPTH-AUDIT.md) (shared-wallet members UI, batch payments UI, email/Slack stubs, A13, CDP, and Wave 1–4 recommendations).

---

## 7. Security / audit register (unchanged truths)

Fixed in prior passes: A1–A12 (subs double-charge, Telegram binding, public org create, role powers, x402 redirects, settlement success, approval unclaim, allowlist/denylist, webhook SSRF, escrow CAS, escrow compliance).

**Still deferred:**  
- **A13** plaintext API keys in SQLite  
- **A14** Prisma unwired  

---

## 8. What to integrate next (ranked)

### P0 — makes product feel “live” and trustworthy
1. **Wire CDP custody + real Base USDC settlement** (Fund tab already shows address).  
2. **A13 hash-at-rest keys** (reveal once).  
3. **Console perf:** stop `refreshAll` after every Agents mutation; Agents page should not wait on freezes/sessions for first paint; cache org agents in shell.

### P1 — operator speed / clarity
4. Inline amount field for group fund (kill `prompt`).  
5. Collapse dual money APIs in Overview to call `wallets/move` only.  
6. Skeleton loaders on Agents/Treasury first paint.  
7. Real email/Slack notifiers (slots exist).

### P2 — scale / enterprise
8. **A14 Postgres** behind `store`.  
9. OTel sink.  
10. SSO/SCIM flags → real IdP.  
11. OpenAPI → Python/Go SDKs.

### Explicitly do **not** add yet
ABI token, LLM free-text money intents, cross-org marketplace, multi-chain, visual automation builder before production versioning.

---

## 9. Console page-by-page health

| Page | Running? | Interactability | Notes |
|------|----------|-----------------|-------|
| Overview | Yes | High | Side-by-side Agents/Move |
| Treasury | Yes | High | Fund / Wallets / Move / Analytics / Recovery |
| Agents | Yes | High | Groups now actionable; perceived load lag |
| Payments | Yes | High | Invoices/Escrows tabs; rails explained |
| Playground | Yes | Very high | 7 missions × 3 run modes |
| Chat | Yes | Med | Polls; factual Q&A |
| Work | Yes | Med | Deliverables from missions |
| Approvals | Yes | High | Core HITL |
| Insights | Yes | Med | Read-only |
| Ledger | Yes | Med | Journals |
| Policy | Yes | High | Best config surface |
| Webhooks | Yes | High | Rotate works |
| Activity | Yes | Med | Export |
| Settings | Yes | Med | Go-live honesty |

---

## 10. Final answer

**Is everything running properly?**  
Yes for the **dev Financial OS**: policy denials, allows, escrow, groups, treasury ledger, webhooks, OpenAPI, MCP tools, and Console flows were exercised live with correct reactions.

**What’s left on the pillars?**  
Not “unbuilt pillars” — **depth**: live money (CDP), key security (A13), database (A14), production notifiers/compliance vendors, and Console performance/polish.

**Fastest win for the slowness you felt:**  
API is already ~10–15 ms. Optimize the **web client fetch waterfall** (Agents first paint + reduce `refreshAll` blast radius) and Next warm caches — that will feel dramatically snappier without changing the money spine.
