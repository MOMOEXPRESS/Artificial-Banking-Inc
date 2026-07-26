# Console UX / Performance / Interactability Audit — Jul 2026

> **Archived — point-in-time.** Written July 2026. Kept for history; it is not a
> description of the current system and is not maintained. The living documents
> are [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) and
> [`docs/ROADMAP.md`](../ROADMAP.md).

**Scope:** Guardian Console (`apps/web`) + agent money spine APIs.  
**Branch:** `cursor/console-ux-audit-1ad2`  
**Method:** Code review of every console view + live API stress probe + persona walkthroughs.

---

## Verdict

The product spine (policy → ledger → rails) is solid. The Console was **operator-hostile in a few places**: Treasury buried deposit/withdraw, Overview stacked Agents above Move funds, agent groups looked decorative, Playground only had three missions, and first-time pages had no guidance. Those are addressed in this pass.

**Overall Console grade: B → B+** after this UX pass (was ~C+ on Treasury / groups / funding discoverability).

---

## Performance / stress probe

Script: `apps/api/scripts/stress-probe.mjs`

```bash
POLICYVAULT_API_URL=http://localhost:8787 node /workspace/apps/api/scripts/stress-probe.mjs
```

Defaults: concurrency 8 × 5 rounds against `/guardian/org`, `/agent/budget`, `/agent/simulate`, `/guardian/activity` after demo bootstrap.

**Measured (local API already on :8787, concurrency 8 × 5 rounds):**

| Surface | ok | fail | wall | ~rps |
|---------|-----|------|------|------|
| `GET /v1/guardian/org` | 40 | 0 | 55ms | ~729 |
| `GET /v1/agent/budget` | 40 | 0 | 19ms | ~2128 |
| `POST /v1/agent/simulate` | 40 | 0 | 37ms | ~1090 |
| `GET /v1/guardian/activity` | 40 | 0 | 14ms | ~2962 |

All probes **0 failures**. SQLite WAL + single Node process is fine for demo / early production read-heavy load; writer cliffs still argue for Postgres (A14) later.

---

## UI review by page (before → after)

| Page | Before | After / notes | Interactability |
|------|--------|---------------|-----------------|
| **Overview** | Agents full-width; Move funds buried below | Agents ‖ Move funds (same pattern as money-went / decisions) | **A** |
| **Treasury** | Tab soup; deposit tucked under Move | **Fund** first (vault address + deposit + withdraw), then wallets / move / analytics | **A−** |
| **Agents** | Profile cramped; groups felt pointless | Spaced profile cards; groups: freeze desk / fund members / assign | **A−** |
| **Payments** | Rails unexplained | Rails copy explains x402 vs transfer-mock | **B+** |
| **Playground** | 3 missions | 7 missions × personas/categories + run modes (once / stress×3 / smoke chain) | **A** |
| **Policy** | Already strong | Unchanged | **A** |
| **Chat / Approvals / Insights / Ledger / Activity / Webhooks / Settings** | Adequate | First-visit **PageTour** banners | **B+** |

---

## Persona matrix (why someone opens ABI)

| Persona | Primary path | Mission / action |
|---------|--------------|------------------|
| Solo founder | Overview → Playground brief | Research brief |
| Ops lead | Policy HITL → Approvals | Large purchase |
| Security | Playground redteam | Compromised agent |
| Marketplace buyer | Escrows | Hire then reject |
| Platform engineer | Smoke chain | Smoke → brief → redteam |
| Desk manager | Agents → Groups | Freeze desk / Fund members |
| Finance | Treasury → Fund / Withdraw | Deposit + withdraw + forecast |

---

## Interactability ranking (all guardian actions)

**Tier 1 — daily money ops (must be obvious)**  
Deposit · Withdraw · Allocate / reclaim / transfer · Freeze agent · Approve / deny · Run mission · Create agent

**Tier 2 — policy & desks**  
Edit policy · Templates · Quorum · Group freeze/fund/assign · Escrow resolve · Invoice pay/void · Schedule / subscribe

**Tier 3 — platform**  
Webhooks + rotate · Merchants · Session keys · Audit export · Recovery key rotate · Automation rules

**Deferred / not interactive yet**  
Live CDP deposit detection · On-chain withdraw broadcast · Visual IF/THEN builder · SSO/SCIM · Usage metering UI

---

## How to load money (today vs live)

1. **Today (dev):** Treasury → **Fund** → “Credit org vault” (`POST /v1/guardian/treasury/deposit`) or Overview allocate from existing demo float.  
2. **Address ready:** Copy vault address on Fund tab (Base Sepolia).  
3. **When CDP is wired:** Same address receives real USDC; indexer credits ledger (deposit API becomes reconciliation, not the only path).  
4. **Withdraw:** Fund tab → Withdraw (ledger outflow; live rail later).

---

## First-run guidance

`PageTour` shows once per view (localStorage `abi_page_tours_v1`). “Got it” dismisses; “Show page guide” restores.

---

## Remaining gaps (honest)

- Chat still reloads history every few seconds (fine for MVP; add ETag later).  
- Overview still uses legacy `/allocate|reclaim|transfer` (works; Treasury uses `/wallets/move`).  
- Stress probe is HTTP-only — not a browser Lighthouse run.  
- Group “Fund members” uses `window.prompt` for amount (functional; polish to inline field later).

---

## Checklist shipped in this pass

- [x] Overview Agents ‖ Move funds  
- [x] Treasury Fund-first redesign + withdraw surface  
- [x] Agent profile spacing  
- [x] Groups: freeze / unfreeze / fund / assign + purpose copy  
- [x] Playground missions + personas + run modes  
- [x] Page tours  
- [x] Rails explanation  
- [x] Stress probe script + this audit
