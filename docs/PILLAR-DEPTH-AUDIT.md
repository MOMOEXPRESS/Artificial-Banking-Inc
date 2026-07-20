# ABI Pillar Depth Audit — every sub-capability

**Date:** 2026-07-20  
**Question:** Have we actually finished all 13 pillars and every sub-point — or only the MVP surfaces?  
**Method:** Code-verified against Console + API (not docs alone). Architecture marks MVP **COMPLETE**; this doc grades **depth**.

Legend:

| Tag | Meaning |
|-----|---------|
| **DONE** | API + Console (or SDK/MCP) work end-to-end for the stated capability |
| **PARTIAL** | Capability exists but UI incomplete, mock-only, or missing a meaningful control |
| **STUB** | Hook registered; behavior is log/placeholder, not production delivery |
| **DEFERRED** | Explicit non-goal or Phase-2 — not a forgotten gap |
| **MISSING** | Claimed or expected but not implemented |

**Verdict in one line:** All 13 pillars have MVP surfaces. **None** is “bank-grade finished.” Roughly **~70% of listed sub-capabilities are DONE**, **~20% PARTIAL/STUB**, **~10% intentionally DEFERRED.**

---

## Pillar 1 — Treasury

| Sub-capability | Depth | Evidence / gap |
|----------------|-------|----------------|
| Organization treasury | **DONE** | Org vault + Fund tab deposit/withdraw |
| Department treasuries | **DONE** | Create dept + list balances in Treasury → Wallets |
| Agent wallets | **DONE** | List available/held; allocate/reclaim via Move |
| Shared wallets | **PARTIAL** | Create works; **always `memberAgentIds: []`**; members count is display-only; member add/remove API exists (`…/shared-wallets/:id/members`) but **no Console UI** |
| Treasury analytics | **DONE** | Cashflow series + forecast runway on Analytics tab |
| Budget allocation | **PARTIAL** | Stipend + daily cap + `wallets/move` work; **not** formal budget envelopes / period POs / department budgets with rollover |
| Multi-wallet management | **DONE** | `GET /wallets` registry + Treasury tabs |
| Asset management | **PARTIAL** | USDC seeded + `GET /assets`; **no multi-asset mint/list UX**; single-asset reality |
| Wallet recovery | **PARTIAL** | Rotate **vault** on Recovery tab; **rotate-agent-key** lives on Agents, not Recovery; recovery log API exists |
| Multi-signature | **PARTIAL** | App-level guardian quorum on treasury moves above HITL — **not on-chain multisig** |
| Treasury forecasting | **DONE** | Runway / burn / projected liquid |
| Cash-flow monitoring | **DONE** | 30d inflow/outflow series |
| Deposit / withdraw | **PARTIAL** | **Ledger mock** (external account), not chain indexer / real USDC pull |

**Pillar 1 score:** MVP ✅ · Depth **7/10**  
**Highest-impact fix:** Shared-wallet member picker + fund-from-shared in Console.

---

## Pillar 2 — AI Agent Management

| Sub-capability | Depth | Evidence / gap |
|----------------|-------|----------------|
| Create / list / detail | **DONE** | Roster + detail pane |
| Rename / profile | **DONE** | PATCH tags, runtime, ownership |
| Archive / restore | **DONE** | Non-spendable + key kill |
| Freeze / unfreeze | **DONE** | Agent + org + desk |
| Freeze audit log | **DONE** | Freezes tab + `/freezes` |
| API key rotate / revoke | **DONE** | Agents actions |
| Session keys | **DONE** | Mint + list + auth |
| Agent groups | **DONE** | Create / assign / fund / freeze desk (API+UI) |
| Ownership | **DONE** | `ownerGuardianId` validated |
| Runs / activity | **PARTIAL** | Detail shows **recent decisions**; **`recentRuns` list not surfaced** in Console (API embeds runs) |
| Agent analytics | **DONE** | Lifetime settled + decision counts |
| Console | **DONE** | Agents nav complete |
| Guardian SDK | **DONE** | Client methods present |

**Pillar 2 score:** MVP ✅ · Depth **8.5/10**  
**Highest-impact fix:** Show runs timeline; kill `prompt()` on Fund members → inline amount.

---

## Pillar 3 — Financial Policies

| Sub-capability | Depth | Evidence / gap |
|----------------|-------|----------------|
| Spend caps + velocity | **DONE** | Engine + Limits UI |
| Allowlists / blocklist | **DONE** | Address / domain / vendor |
| HITL amount + categories | **DONE** | Threshold + tool chips |
| New-counterparty cooldown | **DONE** | Hours control |
| Quiet hours | **DONE** | UTC window |
| Approval quorum | **DONE** | API; UI in **Settings** (easy to miss from Policy) |
| Automation IF/THEN | **DONE** | Rule editor (not visual graph) |
| History simulator | **DONE** | Replay caps/lists/quiet |
| Policy versions + restore | **DONE** | Version list + restore |
| Starter templates | **DONE** | Solo / Swarm / API seller |
| Console + SDK | **DONE** | Full |

**Pillar 3 score:** MVP ✅ · Depth **9/10** (strongest pillar)  
**Polish:** Link quorum from Policy → Settings; visual builder remains DEFERRED.

---

## Pillar 4 — Payments

| Sub-capability | Depth | Evidence / gap |
|----------------|-------|----------------|
| USDC micro `pay` | **DONE** | Agent + Playground |
| x402 `pay_api` | **DONE** | Rail + EIP-712 custody |
| Internal / mock transfer | **DONE** | transfer-mock |
| Escrow L/R/R + timeout | **DONE** | Agent + guardian + sweeper; settling UI honest |
| Subscriptions | **DONE** | CRUD + policy sweeper |
| Invoices | **DONE** | Create / pay / void + tab |
| Scheduled one-shot | **DONE** | Schedule tab |
| Batch enqueue (≤10) | **PARTIAL** | **API only** — no Console batch composer |
| Rail registry | **DONE** | Rails tab |
| PaymentRail + custody | **PARTIAL** | DevLocal live; **CDP stub not go-live** |
| Dual money APIs | **PARTIAL** | Documented; Overview still dual-path feel |
| Usage metering | **DEFERRED** | Phase-2 commerce |

**Pillar 4 score:** MVP ✅ · Depth **7.5/10**  
**Highest-impact fix:** Batch payments UI; CDP wire for real settlement.

---

## Pillar 5 — Observability

| Sub-capability | Depth | Evidence / gap |
|----------------|-------|----------------|
| Metrics / burn / anomalies / economics | **DONE** | Insights + APIs |
| Decision activity | **DONE** | Activity + audit export |
| ObservabilitySink | **DONE** | Console JSON at boot |
| Sink status | **DONE** | `/observability` |
| Vendor ledger | **DONE** | `/vendors` |
| OTel / Prometheus | **DEFERRED** | Interface ready |

**Pillar 5 score:** MVP ✅ · Depth **8/10**

---

## Pillar 6 — Security

| Sub-capability | Depth | Evidence / gap |
|----------------|-------|----------------|
| Roles owner / approver / viewer | **DONE** | Viewer `readOnly` across mutates |
| Freezes + audit | **DONE** | |
| Idempotency + rate limit | **DONE** | |
| Webhook SSRF guard | **DONE** | |
| Audit export | **DONE** | JSON/CSV |
| Key hashing at rest | **MISSING (A13)** | Plaintext in SQLite — intentional defer, **security debt** |

**Pillar 6 score:** MVP ✅ · Depth **6.5/10** (A13 dominates)

---

## Pillar 7 — AI Features

| Sub-capability | Depth | Evidence / gap |
|----------------|-------|----------------|
| Deterministic ask / chat | **DONE** | Facts only |
| FactRephraser hook | **DONE** | Optional |
| Never free-text money | **DONE** | Structured tools |
| LLM policy authoring | **DEFERRED** | Explicit non-goal |

**Pillar 7 score:** MVP ✅ · Depth **9/10** for stated scope

---

## Pillar 8 — Developer Platform

| Sub-capability | Depth | Evidence / gap |
|----------------|-------|----------------|
| REST + OpenAPI | **DONE** | ~103 paths |
| TS SDK | **DONE** | Agent + guardian |
| MCP tools | **DONE** | + wait/list/decision |
| Signed webhooks | **DONE** | HMAC + rotate |
| Multi-lang SDKs | **DEFERRED** | |

**Pillar 8 score:** MVP ✅ · Depth **8/10**

---

## Pillar 9 — Enterprise

| Sub-capability | Depth | Evidence / gap |
|----------------|-------|----------------|
| Multi-guardian + quorum | **DONE** | |
| Org isolation | **DONE** | |
| Org settings JSON | **DONE** | |
| Viewer role | **DONE** | |
| SSO / SCIM | **DEFERRED** | Flags only |

**Pillar 9 score:** MVP ✅ · Depth **7/10**

---

## Pillar 10 — Ecosystem

| Sub-capability | Depth | Evidence / gap |
|----------------|-------|----------------|
| Vendor allowlists + ledger | **DONE** | |
| Merchant directory | **DONE** | CRUD |
| Cross-org marketplace | **DEFERRED** | Non-goal |

**Pillar 10 score:** MVP ✅ · Depth **8/10** for stated scope

---

## Pillar 11 — Notifications

| Sub-capability | Depth | Evidence / gap |
|----------------|-------|----------------|
| In-app chat | **DONE** | |
| Telegram | **DONE** | Optional polling |
| Webhook fan-out | **DONE** | |
| Email / Slack | **STUB** | Log handlers — **no SMTP / Slack API** |
| Discord / push / SMS | **DEFERRED** | Typed slots |

**Pillar 11 score:** MVP ✅ · Depth **5.5/10** (operators won’t get paged)

---

## Pillar 12 — Automation

| Sub-capability | Depth | Evidence / gap |
|----------------|-------|----------------|
| IF/THEN conditions | **DONE** | amount / merchant / budget / balance_below |
| Actions notify/approve/deny/freeze | **DONE** | On intent path |
| Console editor | **DONE** | Form-based |
| Visual builder | **DEFERRED** | |

**Pillar 12 score:** MVP ✅ · Depth **8/10**

---

## Pillar 13 — Compliance

| Sub-capability | Depth | Evidence / gap |
|----------------|-------|----------------|
| Screen on pay + escrow_lock | **DONE** | In executeIntent |
| Env denylist | **DONE** | `ABI_COMPLIANCE_DENYLIST` |
| CompositeScreener | **PARTIAL** | Composable; **not rich default vendors** |
| Status API | **DONE** | |
| Full KYC/AML vendors | **DEFERRED** | |

**Pillar 13 score:** MVP ✅ · Depth **6.5/10**

---

## Honest rollup

| Pillar | MVP | Depth | Honest call |
|--------|-----|-------|-------------|
| 1 Treasury | ✅ | 7.0 | Shared members UI + mock deposit are the weak spots |
| 2 Agents | ✅ | 8.5 | Almost full; runs list + fund UX |
| 3 Policies | ✅ | 9.0 | Best pillar |
| 4 Payments | ✅ | 7.5 | Batch UI + live custody |
| 5 Observability | ✅ | 8.0 | Need OTel for ops |
| 6 Security | ✅ | 6.5 | A13 is the elephant |
| 7 AI Features | ✅ | 9.0 | Scoped correctly |
| 8 Developer | ✅ | 8.0 | TS+MCP enough for now |
| 9 Enterprise | ✅ | 7.0 | SSO when selling enterprise |
| 10 Ecosystem | ✅ | 8.0 | Marketplace correctly deferred |
| 11 Notifications | ✅ | 5.5 | Stubs hurt real ops |
| 12 Automation | ✅ | 8.0 | Form editor fine |
| 13 Compliance | ✅ | 6.5 | Denylist ≠ AML |

**So: you were right to feel “we haven’t gone through everything.”**  
The architecture checklist says COMPLETE because **surfaces exist**. Depth audit says **Treasury shared wallets, Notifications, Security keys, Payments batch/CDP, Compliance vendors** still have unfinished flesh.

---

## Brainstorm — beyond “finish the pillars”

These are **new product moves** (or UX moves) that improve interactability / possible actions — not just filling PARTIAL cells.

### A. Operator job-to-done (highest user-value)

1. **Command palette (⌘K)** — jump to agent, approve pending, allocate stipend, open mission. One surface for power users.  
2. **Guided “First dollar” wizard** — Deposit → Allocate → Allowlist destination → Run mission 1. Collapse 4 pages into one flow.  
3. **Inline group fund** — amount field + confirm (kill `window.prompt`).  
4. **Shared wallet member picker** — multi-select agents + “spend from shared” intent path in Playground.  
5. **Batch payment composer** — CSV/paste destinations ≤10 with simulate-all then enqueue.  
6. **Approval inbox triage** — keyboard approve/deny, bulk resolve same-merchant, snooze.  
7. **Policy “why denied” deep link** — from Activity row → highlight rule that fired + one-click loosen.  
8. **Agent “day in the life” timeline** — merge runs + decisions + payments + freezes into one chron feed.

### B. Money / treasury actions that feel missing

9. **Department budget envelopes** — monthly cap per dept with reclaim-at-month-end.  
10. **Soft / hard holds** — guardian can reserve agent balance without freeze.  
11. **Sweep rules** — “if agent available > X, reclaim to vault nightly.”  
12. **Spend request from agent** — agent proposes allocate; guardian approves (inverse of reclaim).  
13. **Receipt share link** — public/signed receipt URL for counterparties (no login).  
14. **Counterparty nicknames** — map `0x…` → “AWS” in UI everywhere.

### C. Agent / swarm productivity

15. **Agent templates** — “API buyer”, “research swarm lead” with pre-set policy + stipend.  
16. **Desk playbooks** — freeze all → fund → unfreeze as one button (incident response).  
17. **Session key scopes UI** — show remaining spend / TTL countdown; revoke one click.  
18. **Agent health score** — deny rate, review rate, burn vs stipend (Insights already close).

### D. Trust / go-live (makes the product “real”)

19. **CDP custody go-live path** — Fund tab already shows address; wire settle.  
20. **A13 key hashing** — reveal once, store hash.  
21. **Real Slack/email** — HITL alerts that actually reach a phone.  
22. **Dry-run org** vs **live org** badge everywhere so mock deposit isn’t confused with real USDC.

### E. Console performance / feel (you felt Agents slow)

23. **Stop `refreshAll` after local mutations** — patch local state; background revalidate.  
24. **Agents first paint** — agents list only; defer freezes/sessions.  
25. **Skeleton loaders** — perceived latency drops even if ms stay.  
26. **Reduce 4s poll blast** — SSE/webhook push for approvals + activity.

### F. Explicitly do NOT add (still)

- ABI token / crypto wallet cosplay  
- LLM free-text “send money to Bob”  
- Cross-org marketplace  
- Multi-chain before Base USDC is solid  
- Visual IF/THEN before people use version history

---

## Recommended next waves (not calendar — sequencing)

**Wave 1 — Honesty + interactability (no spine risk)**  
Shared wallet members UI · inline group fund · batch payments UI · Overview `wallets/move` only · Agents fetch waterfall · agent runs timeline · counterparty nicknames

**Wave 2 — Operator trust**  
Real Slack/email · A13 hashing · approval triage/keyboard · policy deny deep-link · dry-run vs live badge

**Wave 3 — Live money**  
CDP custody + real settle · deposit indexer · department envelopes / sweep rules

**Wave 4 — Enterprise scale**  
A14 Postgres · OTel · SSO/SCIM · multi-lang SDKs · KYC vendor plugs

---

## Answer to the original question

> “Is everything out of all these 13 pillars and sub-points good / implemented?”

| Layer | Answer |
|-------|--------|
| **MVP surfaces listed in PLATFORM-ARCHITECTURE** | **Yes** — all 13 marked COMPLETE for a reason |
| **Every sub-point at full depth** | **No** — shared members UI, batch UI, email/Slack stubs, A13, CDP, runs list, formal budgets are the clearest gaps |
| **Intentionally unfinished** | Usage metering, OTel, multi-lang SDKs, SSO, marketplace, visual builder, full KYC, LLM policy authoring |
| **Biggest opportunity beyond the checklist** | Operator flows (⌘K, first-dollar wizard, approval triage), swarm desk playbooks, real alerts, live custody — not inventing a 14th pillar |

You hadn’t missed a secret 14th pillar. You’d hit the point where **checklist COMPLETE ≠ product finished.** The wins now are **depth on PARTIAL cells** plus **job-shaped UX** (first dollar, HITL inbox, desk incident), not more architecture tables.
