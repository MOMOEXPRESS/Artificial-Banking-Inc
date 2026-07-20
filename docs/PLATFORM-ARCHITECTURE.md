# ABI Platform Architecture

**Product:** Artificial Banking Incorporated — Financial Operating System for AI Agents  
**Rule:** LLM proposes. Policy + signer authorize. Keys never enter the model.  
**Rule:** Implement what fits today. Expose extension points. Do not block tomorrow.

This document maps the **13 platform pillars** to the live codebase and the
extension points that let each pillar grow without a rewrite.

---

## Treasury pillar (complete)

| Capability | Status | Surface |
|------------|--------|---------|
| Organization treasury | DONE | Org vault + deposit/withdraw |
| Department treasuries | DONE | `POST/GET /v1/guardian/departments` |
| Agent wallets | DONE | Agent available/held + stipend APIs |
| Shared wallets | DONE | `POST/GET /v1/guardian/shared-wallets` + members |
| Treasury analytics | DONE | Wallets registry + metrics rollups |
| Budget allocation | DONE | Unified `POST /v1/guardian/wallets/move` + legacy allocate/reclaim/transfer |
| Multi-wallet management | DONE | `GET /v1/guardian/wallets` + Console → Treasury |
| Asset management | DONE | USDC asset registry (`GET /v1/guardian/assets`) |
| Wallet recovery | DONE | Rotate vault / agent keys + recovery log |
| Multi-signature support | DONE | Treasury moves above HITL require quorum votes |
| Treasury forecasting | DONE | `GET /v1/guardian/treasury/forecast` |
| Cash-flow monitoring | DONE | `GET /v1/guardian/treasury/cashflow` |

---

## AI Agent Management pillar (complete)

| Capability | Status | Surface |
|------------|--------|---------|
| Create / list / detail | DONE | `GET/POST /v1/guardian/agents`, `GET .../agents/:id` |
| Rename / profile | DONE | `PATCH .../agents/:id` + profile merge (tags, runtime, ownership) |
| Archive / restore | DONE | `POST .../archive` / `unarchive` (archived = non-spendable) |
| Freeze / unfreeze | DONE | `POST .../freeze` + org-level `/freeze`; Console roster |
| Freeze audit log | DONE | `GET /v1/guardian/freezes` |
| API key rotate | DONE | `POST .../rotate-key` |
| API key revoke | DONE | `POST .../revoke-key` (kills API + session keys) |
| Session keys | DONE | `POST .../session-keys`, `GET /session-keys`, auth via `pv_sess_…` |
| Agent groups | DONE | `POST/GET /v1/guardian/agent-groups` + assign |
| Ownership | DONE | `profile.ownerGuardianId` validated against guardians |
| Runs / activity | DONE | Detail embeds runs + decisions; `GET /runs` |
| Agent analytics | DONE | `GET .../agents/:id/analytics` |
| Console | DONE | Nav **Agents** → roster / groups / sessions / freezes |
| Guardian SDK | DONE | `AbiGuardianClient` create/list/freeze/rotate/revoke |

---

## Financial Policies pillar (complete)

| Capability | Status | Surface |
|------------|--------|---------|
| Spend caps + velocity | DONE | Engine + Console Limits |
| Allowlists / blocklist | DONE | Address / domain / vendor + blocklist |
| HITL amount threshold | DONE | `hitlAbove` bands |
| HITL categories | DONE | Console tool chips + API |
| New-counterparty cooldown | DONE | Console hours control + engine review |
| Quiet hours | DONE | UTC window review/deny |
| Approval quorum | DONE | `GET/POST /v1/guardian/quorum` |
| Automation IF/THEN | DONE | API + Console rule editor (notify/approve/deny/freeze) |
| History simulator | DONE | Caps + lists + quiet hours replay |
| Policy versions + restore | DONE | Version list with summary + Console restore |
| Starter templates | DONE | Solo / Swarm / API seller + apply-template |
| Console | DONE | Policy view — limits, lists, automation, versions, templates |
| Guardian SDK | DONE | update/simulate/versions/templates/quorum |

---

## Money spine (do not break)

```
Guardian UI / ABI Chat / Telegram     Agent SDK / MCP
              │                              │
              ▼                              ▼
         apps/api (Express)  ←── authAgent / authGuardian
              │
   handleIntent → evaluatePolicy (@policyvault/policy)
              │ allow / deny / review
              │ (+ automation side-effects: notify / freeze)
              ▼
   executeIntent (engine)
     → compliance.screenDestination (CompositeScreener-ready)
     → ledger hold
     → PaymentRail.settle (x402 | transfer-mock)
     → CustodyProvider.signTypedData
     → finalize + webhooks + notifier + ObservabilitySink
```

Persistence stays behind `apps/api/src/store.ts`. Prisma (`packages/db`) is the
aspirational Postgres schema — swap behind `store`, do not dual-write.

---

## Pillars → today → extension points

| # | Pillar | Live today | Extension point |
|---|--------|------------|-----------------|
| 1 | **Treasury** | Org / dept / shared / agent wallets, unified moves + multisig HITL, USDC asset registry, deposit/withdraw, cash-flow, forecast, recovery | `WalletScope` + `accountId` + `transferAvailable`; `GET /v1/guardian/wallets`; Console → Treasury |
| 2 | **AI Agent Management** | Roster, detail, archive, freeze audit, rotate/revoke keys, session keys (`pv_sess_`), groups, ownership, per-agent analytics, Console → Agents | `AgentIdentity` + `AgentProfileHints`; `agent-routes.ts`; `AbiGuardianClient` |
| 3 | **Financial Policies** | Caps, lists, HITL (+ categories), cooldown, quiet hours, quorum, automation editor, versions/restore, templates, history simulator | `policy-routes.ts`; `PolicyTemplate` / `matchedAutomationRules`; Console → Policy |
| 4 | **Payments** | USDC micro, x402 + transfer-mock rails, escrow, subs, invoices | `PaymentRail` interface; `@policyvault/custody` (DevLocal wired, CDP stub ready) |
| 5 | **Observability** | Metrics, insights, vendor/burn/anomaly analytics | Pure `analytics.ts` / `insights.ts`; `ObservabilitySink` |
| 6 | **Security** | Roles (owner/approver/**viewer read**), freezes, idempotency, rate limit, webhook SSRF | Viewer GET path; key hashing deferred behind `store` |
| 7 | **AI Features** | Deterministic ask + chat | `FactRephraser` over facts — never interprets money intents |
| 8 | **Developer Platform** | REST, webhooks, TS SDK, MCP, expanded OpenAPI | `GET /v1/openapi.json`; languages mirror OpenAPI |
| 9 | **Enterprise** | Multi-guardian, quorum, org isolation | `OrgRow.settings` JSON for SSO/plan flags |
| 10 | **Ecosystem** | Vendor allowlists + ledger; **merchant directory** | `MerchantRecord` / `/v1/guardian/merchants` |
| 11 | **Notifications** | In-app chat + Telegram | `registerNotifier(channel)` — email/slack/… slots typed |
| 12 | **Automation** | IF/THEN on policy; notify + freeze side-effects | `balance_below` via injected `walletBalanceMicro` |
| 13 | **Compliance** | Screen on pay + escrow_lock; env denylist | `ComplianceScreener` + `CompositeScreener` |

---

## Packages

| Package | Role |
|---------|------|
| `@policyvault/common` | Money types, wallet scopes, merchants, org settings, notification channels |
| `@policyvault/policy` | Deterministic policy + automation + `PolicyTemplate` |
| `@policyvault/ledger` | Double-entry + `transferAvailable` multi-scope helper |
| `@policyvault/custody` | Signing adapter (dev-local wired; CDP stub ready) |
| `@policyvault/sdk` | Agent (+ thin guardian) HTTP client |
| `@policyvault/db` | Prisma schema (future Postgres) |

---

## What not to do yet

- ABI token / TGE / bonds
- LLM-interpreted policies or free-text money intents
- Cross-org agent marketplace
- Multi-chain beyond Base USDC
- Replacing SQLite with Prisma in one big-bang rewrite
- Visual IF/THEN builders before policy versioning is used in production
- Full KYC/AML vendor integrations (screen interface is enough)

---

## Adding a pillar feature checklist

1. Does it fit the money spine without forking `executeIntent`?
2. Can it plug into custody / `PaymentRail` / notifier / compliance / automation?
3. Does the ledger stay balanced with micro-USDC integers?
4. Is there an OpenAPI path or an explicit “reserved” extension note?

If any answer is no, redesign before shipping.
