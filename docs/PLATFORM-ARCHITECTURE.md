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
              ▼
   executeIntent (engine)
     → compliance.screenDestination
     → ledger hold
     → rails/* (x402 | transfer-mock)
     → custody.signTypedData (future CDP)
     → finalize + webhooks + notifier
```

Persistence stays behind `apps/api/src/store.ts`. Prisma (`packages/db`) is the
aspirational Postgres schema — swap behind `store`, do not dual-write.

---

## Pillars → today → extension points

| # | Pillar | Live today | Extension point |
|---|--------|------------|-----------------|
| 1 | **Treasury** | Org vault + agent stipends, allocate/reclaim/transfer, double-entry | `WalletScope` + `accountId()` in `@policyvault/common`; `dept_*` / `shared_*` `LedgerAccountKind`; `transferAvailable()` |
| 2 | **AI Agent Management** | Agents, API keys, freeze, runs/missions | `AgentRow.profile` JSON; `AgentIdentity` type |
| 3 | **Financial Policies** | Caps, allow/blocklists, HITL, quiet hours, quorum, simulator | `policy_versions` table + `getPolicyVersion()`; `PolicyRules.automation` |
| 4 | **Payments** | USDC micro-units, x402 rail, escrow, subscriptions, invoices | `apps/api/src/rails/*`; `@policyvault/custody` `CustodyProvider` |
| 5 | **Observability** | Metrics, insights, vendor/burn/anomaly analytics | Keep pure functions in `analytics.ts` / `insights.ts` |
| 6 | **Security** | Guardian roles, freezes, idempotency, rate limit | Viewer auth gate; scoped idempotency keys; future key hashing behind `store` |
| 7 | **AI Features** | Deterministic ask + summary | `POST /v1/guardian/chat` + `answerQuestion` fact layer (LLM may rephrase later) |
| 8 | **Developer Platform** | REST, webhooks, TS SDK, MCP | `GET /v1/openapi.json`; SDK languages mirror OpenAPI |
| 9 | **Enterprise** | Multi-guardian + quorum, org isolation | Team/SSO later; do not flatten orgId out of queries |
| 10 | **Ecosystem** | Vendor allowlists + vendor ledger | Merchant directory as data on top of known counterparties |
| 11 | **Notifications** | In-app chat + Telegram | `platform/notifier.ts` `registerNotifier(channel)` |
| 12 | **Automation** | Declarative `automation[]` on policy | `evaluateAutomation` after hard caps in `evaluatePolicy` |
| 13 | **Compliance** | Screening hook + env denylist | `platform/compliance.ts` `ComplianceScreener` |

---

## Packages

| Package | Role |
|---------|------|
| `@policyvault/common` | Money types, error codes, wallet scopes, notification channels |
| `@policyvault/policy` | Deterministic policy + automation hooks |
| `@policyvault/ledger` | Double-entry + multi-scope transfer helper |
| `@policyvault/custody` | Signing adapter (dev-local today, CDP stub ready) |
| `@policyvault/sdk` | Agent HTTP client |
| `@policyvault/db` | Prisma schema (future Postgres) |

---

## What not to do yet

- ABI token / TGE / bonds
- LLM-interpreted policies or free-text money intents
- Cross-org agent marketplace
- Multi-chain beyond Base USDC
- Replacing SQLite with Prisma in one big-bang rewrite
- Visual IF/THEN builders before policy versioning is used in production

---

## Adding a pillar feature checklist

1. Does it fit the money spine without forking `executeIntent`?
2. Can it plug into custody / rails / notifier / compliance / automation?
3. Does the ledger stay balanced with micro-USDC integers?
4. Is there an OpenAPI path or an explicit “reserved” extension note?

If any answer is no, redesign before shipping.
