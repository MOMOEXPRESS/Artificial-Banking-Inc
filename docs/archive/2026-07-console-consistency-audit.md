# Console consistency audit — full surface pass

> **Archived — point-in-time.** Written July 2026. Kept for history; it is not a
> description of the current system and is not maintained. The living documents
> are [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) and
> [`docs/ROADMAP.md`](../ROADMAP.md).

**Date:** 2026-07-21  
**Scope:** Every console area from Overview through Policy / Settings  
**Bar:** Same class as the Finance department / shared pool / agent group bug — promise vs reality, duplicate concepts, decorative controls, money-path lies  
**Reference model:** [Picture A — Budgets vs membership](./decisions/2026-07-21-budgets-vs-team-membership.md)

---

## Executive verdict

Picture A is **started** (Treasury Budgets, ops-label fund-from-budget, ADR).  
**P0–P2 console honesty items from this audit are fixed.**  
Re-open this doc when something “feels like the Finance department bug again.”

Nothing below means “the product is broken end-to-end.” It means **operators can still be taught the wrong mental model** the way they were with dept/pool/group.

---

## Severity legend

| Level | Meaning |
|-------|---------|
| **High** | Will confuse money/control decisions or silently skip a promised safety rail |
| **Med** | Wrong vocabulary, duplicate surfaces, or weak wiring — fix in next polish pass |
| **Low** | Copy/UX nits, minor analytics quirks |

---

## 1. Money — Overview

| ID | Sev | Finding |
|----|-----|---------|
| M1 | High | Footer still points to **department / shared wallets** instead of Budgets / legacy pools (`overview-view.tsx`). |
| M2 | High | **Move funds / Allocate** uses `POST /allocate` (org → agent only). Bypasses budgets; same trap as “org has $10, Finance has the rest.” |
| M3 | High | Overview allocate/reclaim/transfer have **no treasury HITL**; Treasury Move does. Same economic action, different rules. |
| M17 | Med | Copy “spends only through the vault” — engine debits **agent stipend**, vault may only be custody signer. |
| M18 | Med | Underfunded alert → Overview allocate (org-only) instead of Budget → agent. |
| M22–M24 | Low | Calendar day marks collide across months; chart wording; unused imports. |

**Healthy:** KPIs, activity chips, agent list, freeze from Overview (wired).

---

## 2. Money — Treasury

| Tab | Verdict | Issues |
|-----|---------|--------|
| **Fund** | Mostly OK | Deposit is honest as demo ledger **or** on-chain address. |
| **Budgets** | Picture A OK | Create via `/budgets`; ledger scope still named `department` internally (M8). |
| **Move** | Best funding path | HITL for large moves; still shows `department` / legacy `shared` in selectors (M8–M9). No Deny in UI (M11). |
| **Cash** | OK | Liquid total may still include shared while foot says org+budgets+agents (M10). |
| **Recovery** | Partial | Vault rotate audited; agent rotate from UI may skip recovery-audited endpoint (M12). |

| ID | Sev | Finding |
|----|-----|---------|
| M4 | High | Withdraw copy: “large amounts park for approval” — API withdraws **immediately**. |
| M13 | Med | Withdraw “destination” is memo-only, not a payout rail. |
| M14 | Med | `treasuryHitlUsdc` exists in org settings but isn’t editable in Settings UI. |

---

## 3. Money — Payments

| Tab | Verdict | Issues |
|-----|---------|--------|
| **Approvals** | Core works | Held/frozen copy overclaims (no balance hold until execute) (M5). Quorum 202 may still toast as “executed.” |
| **Recents** | OK | Escrow locks mixed into “settled” naming (M20). |
| **Invoices** | OK | “Mark paid” is ledger recognition, not inbound USDC (M28). |
| **Escrow** | OK | Timeout sweep depends on API interval (M29). |
| **Schedule / Batch / Subs** | **High risk** | UI says policy-gated / HITL → Approvals; sweeper **does not create approvals** on review — records error only (M6). Schedule vs Subs duplicate (M19). |
| **Rails** | Low | Always shown “live”; doesn’t reflect CDP plug-in state (M27). |

| ID | Sev | Finding |
|----|-----|---------|
| M7 | High | Standalone `/approvals` page may mis-parse `{ approvals: [] }` as empty. |
| M15 | Med | **Two approval queues**: payment HITL → Approvals; treasury parks → Treasury Move only. |
| M21 | Med | New approval auto-jump opens **Chat**, while banners/tips say Approvals. |

---

## 4. Agents

| Tab | Verdict | Issues |
|-----|---------|--------|
| **Roster** | OK | Create/freeze/rotate/profile wired. |
| **Ops labels** | Picture A started | Tab renamed; buttons still **“Freeze desk”**; create toast still “group” (A2). |
| **Sessions** | **High** | Scopes displayed; **never enforced** in `authAgent`. Mint UI doesn’t even pick scopes (A3–A4). |
| **Freezes** | OK | History works. |

| ID | Sev | Finding |
|----|-----|---------|
| A5 | High | `ownerGuardianId` saved, never used for ACL/approvals. |
| A6 | Med | Runtime/tags profile fields are metadata only. |
| A7 | Med | Can still create Finance **label** + Finance **budget** as unlinked twins (copy warns; model doesn’t stop it). |

---

## 5. Playground

| Tab | Verdict | Issues |
|-----|---------|--------|
| **Scenarios** | OK | Live API / policy / ledger. |
| **Custom** | OK | Step library compiles to real missions. |

| ID | Sev | Finding |
|----|-----|---------|
| P1 | High | Pasted agent key stored as `manual_N` fake id — escrow/attribution wrong. |
| P2 | Med | Filters Commerce / Governance / Security / Ops are **mission tags**, not Settings sections. |
| P3 | Low | “Open Approvals” vs Chat auto-jump inconsistency. |

---

## 6. Chat & Work

| Surface | Verdict | Issues |
|---------|---------|--------|
| **Chat** | Fine for v1 | Real Q&A + inline approvals; duplicates Overview ask panel slightly. |
| **Work** | Fine | Runs/deliverables; “Bill this” toast says Invoices but nav is under Payments. |

---

## 7. Records — Insights

| Tab | Verdict | Issues |
|-----|---------|--------|
| **P&L / Vendors / Forecast / Anomalies** | Wired to APIs | OK functionally. |
| **Activity** | OK | Topbar search is mostly decorative; only Activity uses `query` (I1). |

| ID | Sev | Finding |
|----|-----|---------|
| I1 | Med | Global search opens palette; doesn’t drive a real search box. |
| I2 | Med | “Why denied?” palette jump doesn’t apply that denial as filter. |
| I3 | Med | Activity CSV tip may claim freezes; export is decisions-only. |

---

## 8. Config — Policy

| Tab | Verdict | Issues |
|-----|---------|--------|
| **Limits** | OK | Caps apply to agent spend. |
| **Allowlists** | OK | Empty allowlist denies `pay_api` as claimed. |
| **Schedule & rules** | OK | Quiet hours / cooldown. |
| **Governance** | Duplicate | Quorum also in Settings → Team (C3). |
| **Simulate** | Partial | Dirty detection incomplete vs cooldown/quiet/HITL categories; automation not in simulate body (C4). |

| ID | Sev | Finding |
|----|-----|---------|
| C1 | High | Automation **`budget_exceeded`** = agent **daily spend cap**, not Treasury Budget. Same word as Picture A’s envelope. |
| C2 | High | Tip: merchants pair with Policy allowlists — **false**. Merchants = directory; allowlists = policy hosts; `merchant_unknown` uses spend history counterparts. |

**Note:** Picture A said org defaults ± per-agent policy; **per-agent overrides are not shipped**.

---

## 9. Settings

| Section | Verdict |
|---------|---------|
| Go live / Org / Team / Webhooks / Console / Connect / Danger | Mostly wired |
| Merchants | Metadata only — oversold vs allowlists (C2) |
| Recurring / Webhooks cards | Redirect stubs (OK if labeled) |
| Sound pref | In types, **no UI, never plays** |
| Auto-jump | Claims Approvals; code → Chat |

Commerce / Governance / Security / Ops are **Playground mission filters**, not Settings chapters.

---

## Cross-cutting themes (the real “system” bugs)

1. **Two funding stories** — Overview allocate (org→agent) vs Treasury Move / Budget fund.  
2. **HITL theater** — Withdraw, schedule/HITL, and “held until approve” overclaim.  
3. **Vocabulary collisions** — budget (Treasury) vs `budget_exceeded` (daily cap); desk vs ops label; department vs budget.  
4. **Decorative security** — session scopes, owner guardian id.  
5. **Split inboxes** — Chat vs Approvals vs Treasury pending moves.  
6. **Trinity leftovers** — Overview footer, Freeze desk, shared create API still alive.

---

## Recommended fix order (after this audit)

### P0 — Same class as dept/pool/group (do next)

1. ~~Overview: kill department/shared copy; route funding via Budget → agent (`wallets/move`).~~ **Fixed 2026-07-21** (M1–M3, M18)  
2. ~~Align HITL claims with code (withdraw, payment hold, schedule→Approvals).~~ **Fixed 2026-07-21** — withdraw/hold copy honest; subscription/schedule `review` now creates Approvals (M4–M6)  
3. ~~Rename `budget_exceeded` → `daily_cap_exceeded` (UI + automation).~~ **Fixed 2026-07-21** (C1; deprecated alias kept)  
4. ~~Enforce session scopes **or** remove from UI.~~ **Fixed 2026-07-21** — `authAgent` enforces read/pay/escrow; mint UI picks scopes (A3–A4)  
5. ~~One approval landing (Chat *or* Approvals — pick one and wire all tips/settings/auto-jump).~~ **Fixed 2026-07-21** — auto-jump → Approvals; mobile `/approvals` parses `{ approvals }` (M7, M21)  

Also: merchant tip honesty (C2); ops-label Freeze members copy (A2 partial).

### P1 — Consistency polish

6. ~~Freeze desk → Freeze labeled agents; create-group toasts → ops label.~~ **Fixed 2026-07-21** (A2)  
7. ~~Soft-deprecate shared create API; Move history says “budget”.~~ **Fixed 2026-07-21** — `POST /shared-wallets` → 410; move history uses Budget/Agent labels (M8–M9)  
8. ~~Merchant tip honesty; expose `treasuryHitlUsdc`.~~ **Fixed 2026-07-21** (C2, M14)  
9. ~~Playground paste key → resolve real agent id.~~ **Fixed 2026-07-21** — `/v1/agent/budget` returns `agentId`/`agentName` (P1)  
10. ~~Unify Schedule/Subs or fix HITL into Approvals.~~ **Fixed 2026-07-21** — one Payments → Scheduled tab; HITL already parks Approvals (M19)  

### P2 — Nice cleanup

11. ~~Search bar real or remove.~~ **Fixed 2026-07-21** — topbar is Command palette; denial jumps seed Activity filters (I1–I2)  
12. ~~Sound pref or delete.~~ **Fixed 2026-07-21** — removed dead `sound` from prefs  
13. ~~Calendar marks, CSV tip, liquid-total foot, pricing “shared vault” copy.~~ **Fixed 2026-07-21** (M10, M22, I3, pricing)

---

## Surface scorecard (operator trust)

| Area | Trust now | Notes |
|------|-----------|-------|
| Treasury Budgets + Move | High | Picture A home base |
| Ops label fund-from-budget | High | If source selected correctly |
| Overview allocate | High | Routes via `wallets/move`; fund from org or budget |
| Payments Approvals | Med–High | Works; hold copy honest; mobile parse fixed |
| Schedule / Subs HITL | High | `review` creates Approvals (same as live pay) |
| Session scopes | High | Enforced on agent routes; mint UI picks scopes |
| Policy limits/allowlists | High | Real engine |
| Policy “budget” automation | High | Renamed to `daily_cap_exceeded` (alias kept) |
| Playground presets | High | Live path |
| Insights | High | APIs real; palette → Activity deny filter; CSV tip honest |
| Chat / Work | High | Fine for now |

---

## How to use this doc

- Re-open when something “feels like the Finance department bug again.”  
- Tick IDs (M2, C1, …) in PRs that fix them.  
- Supersede rows by editing this file with date + PR link when fixed.

**Does not replace:** [Budgets vs membership ADR](./decisions/2026-07-21-budgets-vs-team-membership.md). That locks the money model; this audits the rest of the console against it.
