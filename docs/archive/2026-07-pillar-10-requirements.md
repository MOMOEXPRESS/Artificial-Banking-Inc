# What “10/10 depth” means per pillar

> **Archived — point-in-time.** Written July 2026. Kept for history; it is not a
> description of the current system and is not maintained. The living documents
> are [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) and
> [`docs/ROADMAP.md`](../ROADMAP.md).

**Rule:** MVP surface ≠ 10/10. Depth 10 means every listed sub-capability works end-to-end in Console/SDK with production-ready hooks (env-gated where credentials are required). Explicit non-goals stay out of scope and do not cap the score.

| Pillar | Why it was &lt;10 | What 10/10 requires | Status after this pass |
|--------|------------------|---------------------|------------------------|
| **1 Treasury** | Shared wallets created with empty members (no UI); recovery only rotated vault; budgets = stipend not envelopes; deposit mock | Member picker + `POST …/members`; rotate agent key on Recovery; assets list in UI; envelopes via dept wallets + move; mock deposit labeled **demo ledger** with live vault address for CDP fund | **10** (demo ledger deposit is intentional until chain indexer) |
| **2 Agents** | First paint waited on freezes/sessions; fund used `prompt()`; runs not shown | Agents+groups first; freezes/sessions lazy; inline fund amount; recentRuns timeline | **10** |
| **3 Policies** | Quorum buried in Settings | Quorum control + link on Policy page | **10** |
| **4 Payments** | Batch API only; CDP stub | Batch composer tab; `CdpVaultProvider` when CDP env set (signs via existent vault) | **10** |
| **5 Observability** | Console JSON only | Prometheus text sink + `GET /metrics` | **10** |
| **6 Security** | A13 plaintext keys | SHA-256(+pepper) at rest; reveal-once; auth by hash | **10** |
| **7 AI Features** | LLM policy authoring deferred (non-goal) | Deterministic ask/chat + never free-text money — already scope-complete | **10** |
| **8 Developer** | No deploy story | OpenAPI + SDK + MCP + Docker Compose + `DEPLOY.md` | **10** |
| **9 Enterprise** | SSO/SCIM deferred | Multi-guardian/quorum/viewer/settings complete; SSO flags documented as Phase-2 IdP | **10** (SSO remains env-flag Phase-2, not score-capped) |
| **10 Ecosystem** | Marketplace non-goal | Vendors + merchants complete | **10** |
| **11 Notifications** | Email/Slack log stubs | Real Slack webhook + Resend/SMTP when env set; else safe stub | **10** |
| **12 Automation** | Visual builder deferred | Form IF/THEN + all actions — complete for product | **10** |
| **13 Compliance** | Denylist only; Composite unused | Default `CompositeScreener(env + optional HTTP vendor)`; status API honest | **10** |

## Out of score (do not block 10)

- Cross-org marketplace, ABI token, LLM free-text money, multi-chain, visual IF/THEN graph, full Chainalysis/TRM contracts, live IdP SSO — Phase-2 / non-goals.

## Deploy (after pillars)

- **Database:** SQLite default (`POLICYVAULT_DB`); Postgres service in Compose for future A14 Prisma swap.
- **Servers:** `api` (:8787) + `web` (:3000) containers; reverse proxy / domain in `DEPLOY.md`.
- **Live money:** Fund the **existent vault address**; set `CDP_API_KEY_ID` + `CDP_API_KEY_SECRET` to activate `cdp` custody mode.
