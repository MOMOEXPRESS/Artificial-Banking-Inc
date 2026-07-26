# Starting a real organization (no jargon tour)

> **Archived — point-in-time.** Written July 2026. Kept for history; it is not a
> description of the current system and is not maintained. The living documents
> are [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) and
> [`docs/ROADMAP.md`](../ROADMAP.md).

Artificial Banking Inc / PolicyVault is **not a chat app that invents AI agents for you**.  
It is the **wallet + rules layer** for AI agents that spend money:

- You (the **guardian**) hold the org vault and set policy (“who can pay what”).
- Your **agents** (bots you build or run elsewhere) get a spending key and call money APIs.
- The platform decides allow / deny / “ask a human”, then can move **real USDC on Base**.

---

## Login: three doors

| Door | What it is | Agents at start |
|------|------------|-----------------|
| **Create org** | Real organization | **None** — you add them |
| **I have a key** | Paste existing `pv_guardian_…` | Whatever that org already has |
| **Demo** | Wipe + seed “Maya” desk | Researcher + Writer + sample money |

Demo is for trying the product. Production use = **Create org** (or an existing guardian key).

---

## Step-by-step: first real org

### 1. Create the org
Console login → **Create org** → name → save the **guardian key** (shown once).

Ops note: Production must allow create (`POLICYVAULT_ALLOW_PUBLIC_ORG_CREATE=1`).

### 2. What you do inside (guardian)
1. **Treasury → Fund** — copy vault address; send Base Sepolia **USDC** + a little **ETH** (gas). Deposits auto-credit.
2. **Policy** — caps, HITL threshold; address allowlist for wallet pays (Playground can add one).
3. **Agents → Create** — e.g. “Market Scout”. Save the **`pv_agent_…` key once**.
4. **Treasury → Move** — vault → budget (optional) → **agent stipend**.
5. **Approvals** — when a pay needs a human, you Approve/Deny here (or Telegram).

### 3. How you “incorporate” / connect an agent
The platform does **not** host your LLM. You connect by giving your agent the API key:

| Way | How |
|-----|-----|
| **Your code** | Env `POLICYVAULT_API_KEY=pv_agent_…` + REST / `@policyvault/sdk` |
| **MCP** | Tools like `pay`, `pay_api`, `simulate` with the same key |
| **Playground** | Paste the agent key; run missions (same HTTP APIs) |

Create agent in console ≠ “bot that thinks.” It = **named spend wallet + key**.

### 4. What “instructions” can you give?
- **Not** free-text in ABI Chat to move money (chat never spends).
- **Yes:** instructions in *your* agent’s prompt/tools: “when you need data, call `pay` / `pay_api`…”
- **Yes:** Playground missions / Custom steps (scripted calls).
- Money verbs: `simulate`, `pay` (to `0x` wallet), `pay_api` (vendors/URLs), escrow, poll approvals.

### 5. “Pay this wallet right now”
Possible **if** all of these are true:

1. Agent key  
2. Destination `0x` on **address allowlist**  
3. Agent stipend ≥ amount  
4. Vault on-chain USDC ≥ amount + ETH for gas  
5. Policy allows (or you Approve HITL)  

Then: Playground **Agent pays your wallet**, or:

```bash
curl -X POST "$API/v1/agent/pay" \
  -H "Authorization: Bearer pv_agent_…" \
  -H "Content-Type: application/json" \
  -d '{"amountUsdc":"0.10","destination":"0x…","idempotencyKey":"now_1"}'
```

**Why demo had two agents:** bootstrap seeds them. Real org starts empty on purpose.

---

## Why a pay might fail “right now”

| Symptom | Likely cause |
|---------|----------------|
| Create org 403 | `POLICYVAULT_ALLOW_PUBLIC_ORG_CREATE` not `1` |
| Allowlist empty / miss | Add wallet in Policy or use Playground mission |
| Insufficient stipend | Move money to the agent |
| Insufficient on-chain USDC / gas | Fund vault USDC + ETH |
| 202 NEEDS_APPROVAL | Approve in Approvals |

---

## Mental model

```
You (guardian)     →  rules + vault + approvals
Your AI agent      →  thinks / plans in YOUR runtime
PolicyVault        →  “may this spend happen?” + settle USDC
```

Full on-chain proof checklist: [`E2E-ONCHAIN-AGENT-PAY.md`](./E2E-ONCHAIN-AGENT-PAY.md).
