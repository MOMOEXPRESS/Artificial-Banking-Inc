# YC Fall 2026 — Artificial Banking Inc (draft answers)

**Apply:** https://www.ycombinator.com/apply  
**On-time deadline:** July 27, 8pm PT → decision by Aug 28  
**Batch:** Fall 2026 (Oct–Dec, SF)

Copy into the form. Cross out anything that isn’t true for you. Replace `[brackets]`.

**Demo:** https://artificial-banking-inc-gaia10.vercel.app  
(Use whatever Domains URL Vercel shows as Production if it changed after transfer.)

**Repo:** https://github.com/MOMOEXPRESS/Artificial-Banking-Inc  

**Not a bank. Not FDIC. Product money = USDC.**

---

## Company

### Company name
Artificial Banking Inc

### Describe what your company does in 50 characters or less
~49 chars:

```text
Policy wallets so AI agents can spend USDC safely
```

Alt (~47):

```text
Spend controls for AI agents paying in USDC
```

### Company URL
Your Production console URL (Vercel Domains).

### Demo / product link
Same console URL + note: Launch demo org → Treasury Move → Playground → Approvals.

---

## Product (paste these)

### What is your company going to make?

```text
Software that gives every AI agent its own USDC wallet with hard budgets, allowlists, and human approval before spend. Operators set policy in a console; agents call an API/SDK; keys never enter the model. Settles on Base (Coinbase CDP). Not a bank — spend controls between the LLM and the money.
```

### Why did you pick this idea? Why are you the right people?

```text
Agents can already browse and call APIs; the next step is paying. Most stacks give a bot a hot wallet or a human credit card with no policy layer. We built the missing controls: vault → budget → agent stipend → pay under rules → HITL when needed. [1–2 lines: why you personally — e.g. building agents / payments / crypto infra, or pain you hit.]
```

### Why now?

```text
Agent frameworks and x402-style pay-per-request APIs are shipping now. Coinbase CDP makes programmatic wallets usable. USDC on Base is cheap enough for small agent tickets. Without policy, operators either block agents from money entirely or hand them keys and hope — both break at scale.
```

### Progress — what have you built so far?

```text
Working product on Vercel: guardian console + embedded API. Demo org bootstrap with reveal-once keys. Org vault, budgets, agent stipends, policy engine (allow / review / deny), approvals inbox, playground missions, ledger/activity, CDP-backed custody flag on Base Sepolia, optional Telegram hooks. Monorepo with agent SDK, MCP server, x402 seller demo. Live console: [URL].
```

### How do you know people want this?

Be honest. Pick what is true:

```text
[If only demo:] We have a live demo operators can bootstrap in minutes. Early conversations with [N] agent builders / ops people who either refuse to give bots wallets or already had a near-miss overspend. Next: [N] design partners using Sepolia, then one tiny Base mainnet pay.
```

```text
[If you have users:] [N] operators / orgs have used the console. [Specific quote or behavior.] Waitlist: [N].
```

### How will you make money?

```text
SaaS for operator seats + usage on policy-gated payments (per agent / per settlement). Start free/dev; charge when orgs run real USDC volume. No deposit interest. Optional later: take-rate on escrow or marketplace rails — only after usage exists.
```

### How big is the market?

```text
Bottom-up: every team running AI agents that buy APIs, compute, data, or tools needs a spend control layer. If [X] agent ops teams pay $[Y]/mo for treasury/policy tooling, that’s $[Z] near-term. Top-down “agent economy” TAM is noisy; we sell to the human operator of agents, not to the bots.
```

(Fill X/Y/Z with numbers you believe — e.g. 10k serious agent ops × $200/mo = $24M ARR wedge; expand via frameworks embedding the SDK.)

### Who are your competitors? How do you differ?

```text
Coinbase CDP / raw wallets — wallets without org policy UX. Catena / “AI bank” narratives — licensed-bank path, different buyer. Skyfire and agent payment rails — rails/identity more than guardian console + stipend/policy OS. DIY scripts on top of CDP — no shared ledger, approvals, or agent-facing API. We sit between the model and USDC: budgets, stipends, HITL, audit — not a bank charter play.
```

### What do you understand about your users?

```text
Buyer is the human operator (founder, platform ops), not the agent. They need kill switches, per-agent caps, and an approval inbox more than another chatbot. They will not put mainnet USDC in until Sepolia smoke is boring. They confuse “token” with “product money” — we keep USDC as settlement and any community token separate.
```

---

## Founders (YOU fill — be specific)

### Founder name / email / location
Ebale Maurice — momomaurice20006@gmail.com — [city, country]

### Something impressive each founder built or achieved (1–2 sentences)

```text
[Concrete ship: e.g. Built Artificial Banking / PolicyVault end-to-end — console, policy engine, ledger, CDP go-live path — solo in [timeframe]. Prior: [specific product, users, revenue, contest, hard system you beat].]
```

### Equity ownership
Solo: 100% (or list split if cofounder). Be exact.

### How long have you known each other / worked together?
Solo founder → say so. If cofounder: months/years + how you met.

### Are you full-time?
[Yes / will be if funded / still [job].] YC prefers full-time commitment plan.

### Non-computer system you hacked

```text
[One concrete story — bureaucracy, school, marketplace, immigration, sales process, etc. Specific outcome. Not “I hacked life.”]
```

---

## Video (1 minute) — do this

All founders on camera (you). Phone/laptop cam. No slides. No reading.

**Talk track:**

1. “I’m Ebale. We’re Artificial Banking.”  
2. “AI agents are about to spend money. Most stacks have no brakes.”  
3. “We give each agent a USDC wallet with budgets and human approval before spend.”  
4. “Live demo on Base Sepolia with Coinbase CDP — console, playground, approvals.”  
5. “Not a bank. Controls between the model and the money. Looking for YC to [customers / distribution / crypto+AI intros].”

Optional: 5s screen share of Approvals — only if it doesn’t eat the whole minute. Prefer face.

---

## Anything else?

```text
Demo: [URL]. Repo: github.com/MOMOEXPRESS/Artificial-Banking-Inc. Custody path uses Coinbase CDP behind an existing org vault; product money is USDC on Base. Community token (if any) is explicitly separate from the console. Happy to walk through a live Sepolia approve in the interview.
```

---

## Submit checklist

- [ ] Form answers pasted (no marketing fluff)  
- [ ] Demo URL loads without Vercel login wall  
- [ ] 1-min video uploaded  
- [ ] Founder impressive-achievement line is specific  
- [ ] Equity / location / commitment filled  
- [ ] Submit by **July 27, 8pm PT** if you want the Aug 28 decision window  

After submit: keep shipping Sepolia → one real Approve → optional X thread with screenshot (not the YC form).
