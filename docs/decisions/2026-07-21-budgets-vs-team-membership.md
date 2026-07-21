# Decision: Budgets vs team membership (Picture A)

**Status:** Accepted  
**Date:** 2026-07-21  
**Product:** Artificial Banking Incorporated (PolicyVault console)  
**Related symptoms:** Duplicate “Finance” as department + shared pool + agent group; `Fund desk failed: Need 30, org has 10` while money sat in a department/pool; confusion about agents in multiple wallets.

---

## Problem we hit

Operators naturally created:

1. A **Finance department** (wallet)
2. A **Finance shared pool** (wallet + member list)
3. A **Finance agent group** (people, freeze, fund)

Same name, **three unlinked objects**. Moving money Finance dept → Finance pool felt absurd. Funding the group only looked at the **org** vault, not the department/pool. Putting one researcher in Finance *and* Research implied infinite membership × pools × groups.

Root cause: the product mixed **three jobs** into one mental “team wallet”:

| Job | Question |
|-----|----------|
| Where money sits | Budget / cost center |
| Who can spend | Agent identity + stipend |
| Who is on a roster for ops | Optional label (freeze / bulk actions) |

---

## Decision: Picture A — “Employees with cards + cost centers”

### Locked model

```text
Org vault  →  Budget (Finance, Research, …)  →  Agent stipend wallet  →  Pay under policy
```

1. **Budgets** — money envelopes only (rename/replace “departments”; do **not** require agent membership).  
2. **Agents** — the only spenders; each has a personal spend wallet, API key, freeze, audit trail.  
3. **Policy** — rules engine on **spend attempts** (org defaults ± per-agent). The budget does **not** “grant permission” as a chat; it holds balance. Policy decides allow/deny/park; the agent wallet is debited.  
4. **Ops groups** (former “agent groups / desks”) — **optional people labels** for freeze/bulk fund. **Not** a second wallet. Prefer funding agents from a **Budget**, not inventing a parallel Finance group wallet.  
5. **Shared pools** — deprecated as a product concept (legacy rows may remain until emptied). Not spendable; membership did not unlock spend in the engine anyway.

### Cross-functional agents (Finance + Research)

Do **not** put one agent in two money clubs.

Prefer **role instances**:

- `writer-finance` funded from Finance budget  
- `writer-research` funded from Research budget  

Same job title, different spend identities.  
If one agent must bill two budgets later, add “charge this payment to budget X” — **without** multi-pool membership.

### Explicitly rejected for now (can revisit)

- **Picture B:** Agents spend directly from a department/shared desk balance (harder attribution; big engine change).  
- **Matrix desks:** Agent ∈ many desks, each with a wallet (fund/freeze ambiguity).  
- Unifying department + shared + group into one “Desk” that is both roster and wallet (fails the multi-department researcher case).

---

## Implementation notes (this acceptance)

- Console Treasury: primary surface = **Budgets** (backed by existing `departments` ledger accounts).  
- Shared pools UI demoted to legacy holding accounts.  
- Agent “Groups” copy → ops labels; fund API can pull from **org or a budget**, with errors naming the source.  
- Engine spend path unchanged: **agent:{id}:available** only.  
- Docs/index link here so we can restart from this decision if the confusion returns.

---

## How to reopen this decision

If someone again asks “should the wallet own policy?” or “should one agent join many department pools?”, re-read this file first. Change only with a new dated decision that supersedes this one.

**Supersedes:** informal dept / shared / group trinity in console UX.  
**Does not supersede:** org vault custody, agent pay path, x402 org signer vs agent ledger split (document separately if needed).
