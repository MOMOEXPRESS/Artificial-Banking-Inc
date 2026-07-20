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

## Payments pillar (complete)

| Capability | Status | Surface |
|------------|--------|---------|
| USDC micro `pay` | DONE | `POST /v1/agent/pay` → transfer-mock |
| x402 `pay_api` | DONE | `X402Rail` + custody EIP-712 |
| Internal / mock transfer | DONE | Non-URL destinations via transfer-mock |
| Escrow L/R/R + timeout | DONE | Agent + guardian resolve; sweeper |
| Subscriptions | DONE | Create / pause / resume / cancel + policy sweeper |
| Invoices | DONE | Create / pay / void + Console |
| Scheduled one-shot | DONE | `POST /v1/guardian/payments/schedule` |
| Batch enqueue (≤10) | DONE | `POST /v1/guardian/payments/batch` |
| Rail registry | DONE | `GET /v1/guardian/payments/rails` |
| PaymentRail + custody | DONE | Interface + DevLocal wired; CDP stub ready |
| Console | DONE | Nav **Payments** (Recent / Invoices / Escrows / Schedule / Subs / Rails) |
| Guardian SDK | DONE | invoices / subs / escrows / schedule / batch / rails / webhooks |
| Dual money APIs | DONE | Prefer `POST /v1/guardian/wallets/move`; legacy `/allocate` `/reclaim` `/transfer` kept + SDK wrappers |
| Usage metering | DEFERRED | Phase-2 commerce — not required for COMPLETE |

---

## Observability pillar (complete)

| Capability | Status | Surface |
|------------|--------|---------|
| Metrics / burn / anomalies / economics | DONE | `/metrics`, `/burn`, `/anomalies`, `/economics`, Insights |
| Decision activity | DONE | `/activity` + audit export |
| ObservabilitySink | DONE | Console JSON sink at boot; `setObservabilitySink` |
| Sink status | DONE | `GET /v1/guardian/observability` |
| Vendor ledger | DONE | `/vendors` |
| OTel/Prometheus backends | DEFERRED | Plug via sink interface |

---

## Security pillar (complete)

| Capability | Status | Surface |
|------------|--------|---------|
| Roles owner / approver / viewer | DONE | Viewer read-only GET |
| Freezes + audit | DONE | Freeze routes + `/freezes` + audit export |
| Idempotency + rate limit | DONE | Middleware on API |
| Webhook SSRF guard | DONE | `webhook-url.ts` |
| Audit export JSON/CSV | DONE | `GET /v1/guardian/audit/export` |
| Key hashing at rest | DEFERRED | A13 — behind store |

---

## AI Features pillar (complete)

| Capability | Status | Surface |
|------------|--------|---------|
| Deterministic ask / chat | DONE | `/ask`, `/chat`, Insights |
| FactRephraser hook | DONE | `presentAnswer` + optional echo rephraser |
| Never interprets money intents | DONE | Structured tools only |
| LLM policy authoring | DEFERRED | Explicit non-goal |

---

## Developer Platform pillar (complete)

| Capability | Status | Surface |
|------------|--------|---------|
| REST + OpenAPI | DONE | `GET /v1/openapi.json` (expanded stubs) |
| TS SDK agent + guardian | DONE | `@policyvault/sdk` |
| MCP agent tools | DONE | `apps/mcp-server` (+ wait_for_approval / list_activity / get_decision) |
| Signed webhooks | DONE | HMAC deliveries + retries + secret rotate |
| Multi-language SDKs | DEFERRED | Generate from OpenAPI later |

---

## Enterprise pillar (complete)

| Capability | Status | Surface |
|------------|--------|---------|
| Multi-guardian + quorum | DONE | Guardians invite + `/quorum` |
| Org isolation | DONE | Every query scoped by org |
| Org settings JSON | DONE | `GET/PATCH /v1/guardian/settings` |
| Viewer role | DONE | Read-only guardian |
| SSO / SCIM | DEFERRED | Flags in `OrgSettings` only |

---

## Ecosystem pillar (complete)

| Capability | Status | Surface |
|------------|--------|---------|
| Vendor allowlists + ledger | DONE | Policy lists + `/vendors` |
| Merchant directory | DONE | `GET/POST/DELETE /v1/guardian/merchants` |
| Cross-org marketplace | DEFERRED | Explicit non-goal |

---

## Notifications pillar (complete)

| Capability | Status | Surface |
|------------|--------|---------|
| In-app chat | DONE | Default notifier → Chat |
| Telegram | DONE | Optional polling |
| Webhook fan-out | DONE | `registerNotifier("webhook")` |
| Email / Slack slots | DONE | Registered log handlers (swap for SMTP/Slack API) |
| Discord / push / SMS | DEFERRED | Typed channels ready |

---

## Automation pillar (complete)

| Capability | Status | Surface |
|------------|--------|---------|
| IF/THEN on policy | DONE | amount / merchant / budget / balance_below |
| Actions notify / approve / deny / freeze | DONE | Side-effects on intent path |
| Console editor | DONE | Policy → Automation |
| Visual builder | DEFERRED | After production versioning |

---

## Compliance pillar (complete)

| Capability | Status | Surface |
|------------|--------|---------|
| Screen on pay + escrow_lock | DONE | `screenDestination` in executeIntent |
| Env denylist | DONE | `ABI_COMPLIANCE_DENYLIST` |
| CompositeScreener | DONE | Multi-provider composition |
| Status API | DONE | `GET /v1/guardian/compliance` |
| Full KYC/AML vendors | DEFERRED | Interface is enough for COMPLETE |

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
| 4 | **Payments** | USDC pay + x402, escrow, invoices, subscriptions, schedule/batch one-shots, rail registry, Console → Payments | `PaymentRail`; `payment-routes.ts`; custody DevLocal / CDP stub |
| 5 | **Observability** | Complete — analytics + Console JSON sink + status API | `ObservabilitySink` |
| 6 | **Security** | Complete — roles/freezes/audit export JSON|CSV | Viewer GET; key hash deferred |
| 7 | **AI Features** | Complete — ask/chat + FactRephraser hook | `presentAnswer` |
| 8 | **Developer Platform** | Complete — REST/OpenAPI/SDK/MCP/webhooks | OpenAPI generators later |
| 9 | **Enterprise** | Complete — guardians/quorum/`GET|PATCH /settings` | `OrgSettings` JSON |
| 10 | **Ecosystem** | Complete — merchants CRUD + vendor ledger | `MerchantRecord` |
| 11 | **Notifications** | Complete — in-app/Telegram/webhook + email/slack slots | `registerNotifier` |
| 12 | **Automation** | Complete — IF/THEN + Console editor | `matchedAutomationRules` |
| 13 | **Compliance** | Complete — screen + `/compliance` status | `CompositeScreener` |

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
