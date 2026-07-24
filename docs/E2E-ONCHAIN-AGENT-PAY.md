# Progress — E2E on-chain agent pay (Base Sepolia → your wallet)

**Deliverable:** An AI agent (`pv_agent_…`), under policy (+ optional HITL), causes a **real** Base Sepolia USDC `Transfer` from the org vault EOA to **your** Base Sepolia–capable wallet. Basescan + wallet balance prove it.

**Not the proof:** Guardian Treasury Send, ledger-only mock `0xmock_…`, or Coinbase **exchange** deposit (mainnet-only). Use Coinbase Wallet / MetaMask / any EOA on **Base Sepolia**.

**North star loop**

```
Fund vault USDC (+ ETH gas) → Sync → stipend agent
  → allowlist your 0x → agent POST /v1/agent/pay
  → policy allow | HITL approve
  → vault broadcasts USDC.transfer
  → Basescan Transfer + wallet balance
```

---

## Status legend

| Mark | Meaning |
|------|---------|
| `[x]` | Done in repo / verified |
| `[~]` | Partial / ops remaining |
| `[ ]` | Not done |

Update this file as work lands.

---

## L0 — Outer proof surface

| ID | Item | Status | Notes |
|----|------|--------|-------|
| L0.1 | Destination wallet on **Base Sepolia** | `[~]` | Ops: you supply receive `0x` |
| L0.2 | Do **not** use Coinbase exchange deposit for Sepolia | `[x]` | Documented — use Sepolia-capable wallet |
| L0.3 | Acceptance = Basescan Transfer + wallet USDC | `[~]` | Ops after first pay |
| L0.4 | Playground optional (same `/v1/agent/pay`) | `[x]` | Curl / SDK / demo-agent enough |

## L1 — Org / money in

| ID | Item | Status | Notes |
|----|------|--------|-------|
| L1.1 | Org + guardian key (non-wipe create) | `[x]` | `POST /v1/guardian/orgs` or existing key |
| L1.2 | Vault EOA address | `[x]` | Treasury → Vault |
| L1.3 | On-chain deposit detect + Sync (≤2000 block chunks) | `[x]` | `794c3b8` on main |
| L1.4 | Vault has Sepolia **USDC** | `[~]` | Ops: faucet → Sync |
| L1.5 | Vault has Sepolia **ETH** for gas | `[~]` | Ops: required for ERC-20 transfer |
| L1.6 | Move vault → budget → agent stipend | `[x]` | Treasury → Move |

## L2 — Agent identity

| ID | Item | Status | Notes |
|----|------|--------|-------|
| L2.1 | Create agent + one-time `pv_agent_…` | `[x]` | Agents console / API |
| L2.2 | BYO runtime or smoke curl | `[~]` | Smoke steps in this doc |
| L2.3 | Chat / browser stubs | skip | Out of path |

## L3 — Policy

| ID | Item | Status | Notes |
|----|------|--------|-------|
| L3.1 | `pay` requires `0x` + non-empty `addressAllowlist` | `[x]` | Engine already denies empty list |
| L3.2 | Add your wallet to address allowlist | `[~]` | Ops: Policy → Allowlists |
| L3.3 | HITL / amount bands | `[x]` | Approve once for the story |
| L3.4 | Do **not** use `pay_api`/x402 for wallet EOA | `[x]` | Documented |

## L4 — API / intent spine

| ID | Item | Status | Notes |
|----|------|--------|-------|
| L4.1 | `handleIntent` → policy → HITL → `executeIntent` | `[x]` | |
| L4.2 | Approvals inbox (+ optional Telegram) | `[x]` | |
| L4.3 | Idempotency keys | `[x]` | |

## L5 — Settlement rail (core gap)

| ID | Item | Status | Notes |
|----|------|--------|-------|
| L5.1 | `EvmUsdcTransferRail` — vault `USDC.transfer` | `[x]` | `apps/api/src/rails/evm-usdc-transfer.ts` |
| L5.2 | `executeIntent`: `pay` + `0x` → real rail (not mock) | `[x]` | Mock only if `POLICYVAULT_MOCK_TRANSFER=1` |
| L5.3 | Keep mock for non-address / vendor `pay_api` | `[x]` | |
| L5.4 | Register rail in `/v1/guardian/payments/rails` | `[x]` | |
| L5.5 | Clear errors: no key / no USDC / no ETH gas | `[x]` | `INSUFFICIENT_*` / `CUSTODY_UNAVAILABLE` |

## L6 — Custody

| ID | Item | Status | Notes |
|----|------|--------|-------|
| L6.1 | Vault key lookup + EIP-712 sign (x402) | `[x]` | |
| L6.2 | Broadcast path using vault key (viem wallet client) | `[x]` | `apps/api/src/chain/transfer.ts` |
| L6.3 | True CDP Server Wallet | skip | Later; not needed for Sepolia proof |
| L6.4 | Paymaster / gas sponsorship | skip | Fund vault with ETH instead |

## L7 — Ledger vs chain

| ID | Item | Status | Notes |
|----|------|--------|-------|
| L7.1 | Hold / finalize stipend on pay | `[x]` | |
| L7.2 | Pre-check on-chain USDC ≥ amount before broadcast | `[x]` | Also ETH ≠ 0 gas floor |
| L7.3 | After pay: Refresh shows lower vault USDC | `[~]` | Follows from real transfer |

## L8 — Observability

| ID | Item | Status | Notes |
|----|------|--------|-------|
| L8.1 | Return real `txHash` on pay result | `[x]` | Pay payload `txHash` |
| L8.2 | Explorer URL in response / activity when possible | `[x]` | `resource.explorerUrl` |
| L8.3 | Webhooks on payment events | `[x]` | Existing emits |

## L9 — Compliance (out of critical path)

| ID | Item | Status | Notes |
|----|------|--------|-------|
| L9.1 | KYC / full KYT | skip | Allowlist + HITL for this proof |
| L9.2 | Compliance screen hook | `[x]` | Allow-all default |

## L10 — Hosting / env

| ID | Item | Status | Notes |
|----|------|--------|-------|
| L10.1 | Production on tip of `main` | `[~]` | Ops redeploy |
| L10.2 | `CHAIN=base-sepolia`, bootstrap=`0`, pepper | `[~]` | Ops |
| L10.3 | CDP keys | optional | Label only today |

---

## Crucial vs little things

### Crucial (deliverable dies without these)

- [x] **C1** Real USDC transfer rail + `executeIntent` switch  
- [x] **C2** Vault can broadcast with its key  
- [ ] **C3** Vault funded with USDC **and** ETH *(ops — you)*  
- [ ] **C4** Address allowlist includes your receive `0x` *(ops — you)*  
- [ ] **C5** Agent stipend + policy allow / HITL approve *(ops — you)*  
- [ ] **C6** Confirm on Basescan + wallet — not console alone *(ops — you)*  

### Important (secondary)

- [x] **I1** On-chain USDC pre-check before settle  
- [x] **I2** Real `txHash` + explorer link in API payload  
- [x] **I3** Rail registry updated  
- [x] **I4** Mock `0x` pays only if `POLICYVAULT_MOCK_TRANSFER=1`  

### Little / later

- [ ] **T1** CDP Server Wallet  
- [ ] **T2** Paymaster  
- [ ] **T3** Postgres, signup UI, KYC, chat browser  
- [ ] **T4** Base mainnet + exchange deposit (separate track)  

---

## Build order (this branch)

1. [x] Progress sheet (this file)  
2. [x] `chain/transfer.ts` — `transferUsdcFromVault`  
3. [x] `rails/evm-usdc-transfer.ts`  
4. [x] Wire `executeIntent` + rails registry + pre-check  
5. [x] Smoke steps below (+ `PAY_TO_ADDRESS` on demo-agent)  
6. [ ] Merge to `main` → redeploy → your live pay test  

---

## Smoke (after deploy)

Replace placeholders. Amount should be small (e.g. `0.10`).

```bash
# 1) Guardian: allowlist your Base Sepolia wallet
curl -s -X POST "$API/v1/guardian/policy" \
  -H "Authorization: Bearer $GUARDIAN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"addressAllowlist":["0xYOUR_WALLET"]}'

# 2) Ensure agent has stipend (Treasury → Move in console, or allocate API)

# 3) Agent pay
curl -s -X POST "$API/v1/agent/pay" \
  -H "Authorization: Bearer $AGENT_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "amountUsdc":"0.10",
    "destination":"0xYOUR_WALLET",
    "idempotencyKey":"e2e_pay_1",
    "memo":"e2e sepolia wallet proof"
  }'

# 4) If 202 NEEDS_APPROVAL → Approvals → Approve, then re-check decision / Basescan
# 5) Open explorerTx from response — confirm Transfer vault → you
```

**Pass criteria:** USDC balance increases in your Base Sepolia wallet; Basescan shows the Transfer from the org vault.
