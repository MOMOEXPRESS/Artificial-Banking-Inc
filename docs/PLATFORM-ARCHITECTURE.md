# ABI Platform Architecture

**Product:** Artificial Banking Incorporated — Financial Operating System for AI Agents  
**Rule:** LLM proposes. Policy + signer authorize. Keys never enter the model.  
**Rule:** Implement what fits today. Expose extension points. Do not block tomorrow.

This document maps the **13 platform pillars** to the live codebase and the
extension points that let each pillar grow without a rewrite.

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
| 1 | **Treasury** | Org vault + agent stipends via `accountId` + `transferAvailable` | `WalletScope`; reserved `dept_*` / `shared_*` kinds; same journal helper |
| 2 | **AI Agent Management** | Agents, keys, freeze, runs; `PATCH .../agents/:id/profile` | `AgentIdentity` + `AgentProfileHints`; profile JSON for groups/ownership |
| 3 | **Financial Policies** | Caps, lists, HITL, quiet hours, quorum, simulator, **automation[]** on policy API | `policy_versions` + restore; `PolicyTemplate` / `matchedAutomationRules` |
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
