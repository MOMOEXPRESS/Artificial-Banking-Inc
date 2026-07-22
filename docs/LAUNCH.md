# Launch playbook — Artificial Banking Inc

One place for **go-live money rails**, **hosting**, **Solana community token**, and **X**.  
Do these as parallel tracks, but ship in this **order** so you don’t look like a memecoin wearing a banking costume.

```
Track A  Product go-live (CDP / Base / Telegram / real session)
Track B  Hosting (keep *.vercel.app for now)
Track C  Solana token (pump.fun + Phantom) — separate from the console
Track D  X marketing (product first, token second)
```

---

## North star (what “live” means)

| Live means | Not required day one |
| --- | --- |
| Console reachable on a public URL | Custom `.com` domain |
| API running with real env (pepper, no public bootstrap wipe) | Postgres |
| CDP keys set → custody mode `cdp` | Token inside the console |
| Vault funded with USDC (Sepolia first, then Base) | Cloudflare Pages migration |
| You can run Playground / agent pay → HITL approve for real | CEX listing |
| Optional: Telegram approve/deny | |

**Console money = USDC on Base.**  
**Community token = Solana (pump.fun) — optional, separate story.**

---

## Track A — Product go-live (do this first)

### A0. Hosting decision (2 minutes)

**Recommendation: keep Vercel.**

| Option | Verdict |
| --- | --- |
| **Vercel `*.vercel.app`** | Already live: https://artificial-banking-inc-gaia10.vercel.app — best fit for Next.js console |
| Cloudflare Pages `*.pages.dev` | Fine for static sites; painful for this Next + API monorepo. Skip unless you enjoy rewriting deploys |

No `.com` needed. Bookmark the gaia10 URL. Harden auth if needed: `docs/VERCEL.md`.

API must also be reachable (`NEXT_PUBLIC_API_URL` → your API). If API isn’t on Vercel yet, use your current API host / Docker / Railway / Fly — same checklist below.

### A1. Env checklist (you fill these)

Copy from `.env.example` into production secrets:

| Variable | Why |
| --- | --- |
| `ABI_KEY_PEPPER` | Strong random — key hashing. **Required** |
| `POLICYVAULT_ALLOW_BOOTSTRAP=0` | Stops demo wipe on prod. **Required** |
| `CDP_API_KEY_ID` + `CDP_API_KEY_SECRET` | Turns custody into `cdp` behind vault address |
| `CHAIN=base-sepolia` then later `base` | Network |
| `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` | Approve from Telegram (optional but useful) |
| `TELEGRAM_ALLOWED_USER_IDS` | Lock who can press Approve |
| `NEXT_PUBLIC_API_URL` | Console → API (build-time for web) |

Get CDP keys: Coinbase Developer Platform → API keys.  
Telegram: [@BotFather](https://t.me/BotFather) → bot token; message the bot, then get chat id (`@userinfobot` or API `getUpdates`).

### A2. Fund + smoke a real session (Sepolia first)

1. Open Console → **Treasury → Vault** → copy vault address  
2. Send **Base Sepolia USDC** (and a bit of Sepolia ETH for gas if needed)  
3. Confirm Settings / setup shows custody **cdp** (not mock) once CDP env is set  
4. Create / pick an agent → fund stipend from budget (**Treasury → Move**)  
5. **Playground** → run a small mission (or Chat) so a pay hits policy  
6. Approve in Console **or** Telegram  
7. Confirm Activity / Ledger / webhook delivery log look sane  

When Sepolia is boring and green: flip `CHAIN=base`, fund **mainnet USDC**, repeat a tiny live pay.

### A3. “Actual session” definition (done when)

- [ ] Public console URL loads without Vercel login wall  
- [ ] Guardian login works  
- [ ] CDP active  
- [ ] Vault has USDC  
- [ ] Agent paid under policy at least once  
- [ ] HITL approval path worked once  
- [ ] Bootstrap wipe disabled  

---

## Track B — Hosting (simple)

| Now | Later |
| --- | --- |
| Keep **vercel.app** for console | Buy a `.com` and point DNS when you care about brand |
| Keep API wherever it already runs; set `NEXT_PUBLIC_API_URL` | Same hostname under custom domain |

Don’t migrate to Cloudflare Pages mid-launch unless the Vercel URL is broken.

---

## Track C — Solana community token (pump.fun)

**No domain. No Base. No console wiring.**

This replaces the “I need a .com for Base” confusion. pump.fun is a **UI launcher**:

### C1. What you need personally

1. **Phantom** (or Solflare) wallet  
2. A little **SOL** for fees + initial buy  
3. Token name / ticker / image (square PNG)  
4. Account on [pump.fun](https://pump.fun)

### C2. Create on pump.fun (click path)

1. Connect Phantom  
2. **Create coin** → name, ticker, description, image  
3. Description blurb (honest):

   > Community token to help fund Artificial Banking Inc (AI agent spend controls).  
   > Not part of the product. Product money is USDC. Not a bank. Not a deposit.

4. Launch / create  
5. Buy a small bag yourself if you want skin in the game  
6. Copy: pump link, mint address, Dexscreener when it appears  

### C3. What we already have in-repo (optional / later)

`contracts/` = **Base ERC-20 (ABINC)** via Foundry — only if you later want Base as well.  
For “Phantom + pump.fun + FOMO,” **you do not need that package**. Solana path is pump.fun.

### C4. Hard rules

- Never put the mint inside `/console` or agent balances  
- Never say the token “backs” vaults or deposits  
- Product announce ≠ token announce (see Track D)

---

## Track D — X + launch messaging

### Sequence (same week is OK if posts are separate)

| When | Post |
| --- | --- |
| **Day 0** | Product live thread (console demo / approval screenshot) — **no token** |
| **Day 0–1** | Reply to everyone; post a 20s Playground clip |
| **Day 2–4** | Soft token note *or* pump link — “separate community coin, not the product” |
| **Ongoing** | Build-in-public scraps > hashtag spam |

### Product thread (human)

```text
1/
ok so i've been building this thing for a while and i think it's finally worth showing people

ai agents can already browse and hit apis
they're gonna start spending money next
most stacks have basically zero brakes for that

i built Artificial Banking for that problem

2/  [screenshot: Approvals / policy]
each agent gets its own wallet + budget
you set the rules
anything big waits for a human
settles in usdc on base

not a bank. not fdic. just controls between the model and the money.

3/
demo:
https://artificial-banking-inc-gaia10.vercel.app
```

Hashtags: **none**, or one of `#AIAgents` / `#Base`.

### Token follow-up (later)

```text
quick note since people ask

there's a community coin on solana to help fund building
it's not part of the console
it doesn't sit in agent wallets
product money = usdc

if that's not your thing, ignore it and use the demo
[pump.fun link]
```

---

## One-week calendar (launch everything without mixing wires)

| Day | You do | Ship / post |
| --- | --- | ---|
| **1** | CDP keys + pepper + bootstrap=0 in prod | — |
| **1** | Confirm vercel.app console + API URL | Soft “working on go-live” if you want |
| **2** | Fund Sepolia vault USDC; Telegram bot | — |
| **2–3** | Full smoke: Move → Playground → Approve | **X product thread** + demo link |
| **3** | Create pump.fun coin (Phantom) | Save mint; don’t spam it yet |
| **4** | Fix whatever broke in smoke | Demo video reply |
| **5** | Optional: token tweet (separate) | pump link + disclaimer |
| **6–7** | Tiny Base mainnet pay *or* keep Sepolia | Metrics / “what broke” thread |

---

## Personal checklist (only you can click)

### Product
- [ ] Coinbase CDP API key id + secret in prod  
- [ ] `ABI_KEY_PEPPER` set; bootstrap off  
- [ ] Telegram bot + chat id (optional)  
- [ ] Sepolia USDC on vault → real approve once  
- [ ] Console URL public (Vercel harden if locked)

### Token
- [ ] Phantom + SOL  
- [ ] pump.fun create + image + honest description  
- [ ] Mint / pump URL saved  

### X
- [ ] Product thread with console screenshot  
- [ ] Token post later, clearly separate  

---

## Where docs live

| Doc | Use |
| --- | --- |
| **This file** | Launch orchestration |
| `docs/DEPLOY.md` | Docker / VPS / CDP fund steps |
| `docs/VERCEL.md` | vercel.app URL + harden |
| `contracts/README.md` | Optional Base ERC-20 (not needed for pump.fun) |
| `docs/plans/abi-gtm-fundraising.md` | Why token ≠ product |

---

## Bottom line

1. **Go live the product on Base + CDP + (optional) Telegram** using the existing **vercel.app** link.  
2. **Launch the community coin on Solana via pump.fun + Phantom** — no domain, no Base requirement.  
3. **Market product first on X; token second** with a clear “not the console” line.

When you’re ready for the next concrete step, say which track: **A (CDP smoke)** or **C (pump.fun copy + image prompts)** — we’ll do that one hands-on.
