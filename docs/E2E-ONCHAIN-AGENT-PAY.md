# Progress — E2E **agent** on-chain pay (Base Sepolia → your wallet)

**Correct understanding (locked):** The proof is the **agent** calling `POST /v1/agent/pay` under policy. The vault then broadcasts a real USDC `Transfer` to your wallet.

**Not the proof:** Guardian Treasury **Send / Receive** (ledger demo only). That is *not* what we are building toward.

```
Vault funded (USDC + ETH) → auto-credit ledger → Move stipend to agent
  → allowlist your 0x (Playground can do this)
  → AGENT /v1/agent/pay  → policy / HITL
  → EvmUsdcTransferRail broadcasts USDC.transfer
  → Basescan + your wallet balance
```

---

## What’s left (honest)

| Layer | Build left? | You (ops)? |
|-------|-------------|------------|
| L0 Proof wallet on Sepolia | no | yes — paste `0x` |
| L1 Fund vault USDC + ETH | no | yes |
| L1 Auto-credit deposits | **done** | open Fund |
| L2 Agent key in Playground | no | paste agent key once |
| L3 Allowlist | **done in Playground mission** | or Policy UI |
| L4 Intent / HITL | done | Approve if parked |
| L5 Real USDC rail for agent `pay` | **done** | — |
| L6 Broadcast from vault key | **done** | vault needs ETH gas |
| L7–L8 Pre-check + txHash | done | confirm Basescan |
| L9 KYC / chat stubs | skip | — |
| L10 Production deploy | tip of `main` | wait for Vercel |

**Crucial remaining = ops only (C3–C6):** fund vault, stipend agent, run Playground **Agent pays your wallet**, confirm Basescan.

---

## Status by layer

### L0 — Outer proof
| ID | Status | Notes |
|----|--------|-------|
| L0.1 Sepolia-capable wallet | `[~]` | You supply `0x` |
| L0.2 Not Coinbase exchange | `[x]` | |
| L0.3 Basescan acceptance | `[~]` | After first agent pay |
| L0.4 Playground = same agent API | `[x]` | |

### L1 — Money in
| ID | Status |
|----|--------|
| L1.1–L1.3 Org, vault, auto-credit | `[x]` |
| L1.4 USDC on vault | `[~]` ops |
| L1.5 ETH gas on vault | `[~]` ops |
| L1.6 Stipend via Move | `[x]` product / `[~]` ops once |

### L2 — Agent
| ID | Status |
|----|--------|
| L2.1 Create agent + key | `[x]` |
| L2.2 Playground / SDK / curl | `[x]` |
| L2.3 Chat stubs | skip |

### L3 — Policy
| ID | Status |
|----|--------|
| L3.1–L3.4 Allowlist + HITL + not pay_api | `[x]` |
| L3.2 Your address on list | `[~]` ops / auto in Playground mission |

### L4 — Spine | `[x]`
### L5 — Agent settlement rail | `[x]` **this is the product**
### L6 — Custody broadcast | `[x]`
### L7–L8 Ledger + observability | `[x]`
### L9 Compliance extras | skip
### L10 Hosting | `[~]` redeploy tip

---

## Crucial vs little

### Crucial
- [x] C1 Agent `pay` → real USDC rail  
- [x] C2 Vault can broadcast  
- [ ] C3 Vault USDC + ETH *(you)*  
- [ ] C4 Allowlist *(you or Playground mission)*  
- [ ] C5 Stipend + Run agent mission / HITL *(you)*  
- [ ] C6 Basescan + wallet *(you)*  

### Important UX (this branch)
- [x] Playground wallet field + amount for agent proof  
- [x] Mission auto-allowlists address via guardian policy  
- [x] Label Treasury Send as **not** the proof  
- [x] Progress sheet rectified to agent-only  

### Later (not needed for proof)
- [ ] T1 CDP Server Wallet · T2 Paymaster · T3 Postgres/signup/KYC/chat · T4 Mainnet exchange  

---

## How you run the proof (after deploy)

1. Treasury → Fund: vault shows USDC (auto-credit) + some ETH  
2. Treasury → Move: stipend the agent  
3. Playground: paste **agent** key if needed  
4. Scenario **Agent pays your wallet (E2E proof)** → paste your Base Sepolia `0x` → amount `0.10` → **Run mission**  
5. Approve if HITL  
6. Open Basescan link in the step output — wallet USDC up  

That is the entire system working: **agent + policy + custody + chain**.
