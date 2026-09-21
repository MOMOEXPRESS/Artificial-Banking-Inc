# Launch playbook — Artificial Banking Inc

One place for **go-live money rails**, **hosting**, **Solana community token**, and **X**.  
Do these as parallel tracks, but ship in this **order** so you don’t look like a memecoin wearing a banking costume.

```
Track A  Product go-live (self-custody / Base / Telegram / real session)
Track B  Hosting (keep *.vercel.app for now)
Track C  Solana token (pump.fun + Phantom) — separate from the console
Track D  X marketing (product first, token second)
```

---

## North star (what “live” means)

| Live means                                                   | Not required day one       |
| ------------------------------------------------------------ | -------------------------- |
| Console reachable on a public URL                            | Custom `.com` domain       |
| API running with real env (pepper, no public bootstrap wipe) | Postgres                   |
| `ABI_KEK` backed up → application-managed custody disclosed  | Managed MPC/HSM custody    |
| Vault funded with USDC (Sepolia first, then Base)            | Cloudflare Pages migration |
| You can run Playground / agent pay → HITL approve for real   | CEX listing                |
| Optional: Telegram approve/deny                              |                            |

**Console money = USDC on Base.**  
**Community token = Solana (pump.fun) — optional, separate story.**

---

## Track A — Product go-live (do this first)

### A0. Hosting decision (2 minutes)

**Recommendation: keep Vercel. Skip Cloudflare Pages for this repo.**

| Option                         | Verdict                                                                                        |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| **Vercel `*.vercel.app`**      | Correct host for this Next + `/abi-api` monorepo                                               |
| Cloudflare Pages `*.pages.dev` | Build may pass; `wrangler deploy` fails at monorepo root and runtime doesn’t match — don’t use |

**Canonical URL (when deploy is Ready):**  
https://artificial-banking-inc-gaia10.vercel.app

If that URL returns `x-vercel-error: NOT_FOUND`, there is no live production deployment — recreate / redeploy with the settings below (no `.com` needed).

#### Vercel import / repair (click path)

1. Open https://vercel.com → team **gaia10** (or your team)
2. **Add New… → Project** → import **Artificial-Banking-Inc** from GitHub  
   (or open existing project **artificial-banking-inc**)
3. **Root Directory** = `apps/web`  
   Leave “Include source files outside root” **ON**
4. Framework = **Next.js** (auto)
5. Install / build are already in `apps/web/vercel.json` — don’t override unless empty
6. Env (Production): at least
   - `ABI_KEY_PEPPER` = long random string
   - `POLICYVAULT_ALLOW_BOOTSTRAP` = `0`
   - later: `ABI_KEK`, `CHAIN`, Telegram keys
7. **Deploy**
8. **Settings → Deployment Protection** → turn **off** Vercel Authentication  
   (or run `VERCEL_TOKEN=… npm run vercel:harden` — see `docs/VERCEL.md`)
9. Open the URL Vercel shows under **Domains** (usually `artificial-banking-inc-gaia10.vercel.app`)

Bookmark whatever Domains lists as Production — that is your public link.

#### Leave gaia10 **without** deleting the project

Do **not** delete the project or the GitHub repo. **Transfer** it first, then leave/delete the empty team.

1. Vercel → switch to team **gaia10** → open **artificial-banking-inc**
2. **Settings → General** → scroll to **Transfer Project**
3. Click **Transfer** → choose your **Personal** account (Hobby) — or another team you own  
   You must be an **Owner** on gaia10 and a member of the destination.
4. Confirm. Wait until transfer finishes (seconds to a few minutes).  
   Deployments keep working; the `*.vercel.app` hostname may change (team slug drops out of the URL).
5. Switch the team picker to **your personal account** → confirm the project is there and the new Domains URL loads.
6. Only then, to ditch gaia10:
   - Team switcher → **gaia10** → **Settings → Members** → remove yourself, **or**
   - If you’re the last owner and the team is empty of projects: **Settings → General → Delete Team**

**Never** hit **Delete Project** on artificial-banking-inc. Transfer ≠ delete.

After transfer, update bookmarks / X links to the **new** Domains URL from the personal account.

### A1. Env checklist (you fill these)

Copy from `.env.example` into production secrets:

| Variable                                  | Why                                                                         |
| ----------------------------------------- | --------------------------------------------------------------------------- |
| `ABI_KEY_PEPPER`                          | Strong random — key hashing. **Required**                                   |
| `POLICYVAULT_ALLOW_BOOTSTRAP=0`           | Stops demo wipe on prod. **Required**                                       |
| `ABI_KEK`                                 | Encrypts application-managed vault keys; losing it makes them undecryptable |
| `CHAIN=base-sepolia` then later `base`    | Network                                                                     |
| `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` | Approve from Telegram (optional but useful)                                 |
| `TELEGRAM_ALLOWED_USER_IDS`               | Lock who can press Approve                                                  |
| `NEXT_PUBLIC_API_URL`                     | Console → API (build-time for web)                                          |

Managed Coinbase CDP custody is a roadmap integration, not a current capability.  
Telegram: [@BotFather](https://t.me/BotFather) → bot token; message the bot, then get chat id (`@userinfobot` or API `getUpdates`).

### A2. Fund + smoke a real session (Sepolia first)

**Click-by-click:** [`docs/GO_LIVE.md`](./GO_LIVE.md)

1. Open Console → **Treasury → Vault** → copy vault address
2. Send **Base Sepolia USDC** (and a bit of Sepolia ETH for gas if needed)
3. Confirm **Settings → Go live** shows application-managed custody and **Network** = `CHAIN`
4. Create / pick an agent → fund stipend from budget (**Treasury → Move**)
5. **Playground** → run a small mission (or Chat) so a pay hits policy
6. Approve in Console **or** Telegram
7. Confirm Activity / Ledger / webhook delivery log look sane

When Sepolia is boring and green: flip `CHAIN=base`, fund **mainnet USDC**, repeat a tiny live pay.

### A3. “Actual session” definition (done when)

- [ ] Public console URL loads without Vercel login wall
- [ ] Guardian login works
- [ ] Self-custody warning reviewed and `ABI_KEK` backed up
- [ ] Vault has USDC
- [ ] Agent paid under policy at least once
- [ ] HITL approval path worked once
- [ ] Bootstrap wipe disabled

---

## Track B — Hosting (simple)

| Now                                                          | Later                                                |
| ------------------------------------------------------------ | ---------------------------------------------------- |
| Keep **vercel.app** for console                              | Buy a `.com` and point DNS when you care about brand |
| Keep API wherever it already runs; set `NEXT_PUBLIC_API_URL` | Same hostname under custom domain                    |

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

| When        | Post                                                                        |
| ----------- | --------------------------------------------------------------------------- |
| **Day 0**   | Product live thread (console demo / approval screenshot) — **no token**     |
| **Day 0–1** | Reply to everyone; post a 20s Playground clip                               |
| **Day 2–4** | Soft token note _or_ pump link — “separate community coin, not the product” |
| **Ongoing** | Build-in-public scraps > hashtag spam                                       |

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

| Day     | You do                                  | Ship / post                           |
| ------- | --------------------------------------- | ------------------------------------- |
| **1**   | KEK + pepper + bootstrap=0 in prod      | —                                     |
| **1**   | Confirm vercel.app console + API URL    | Soft “working on go-live” if you want |
| **2**   | Fund Sepolia vault USDC; Telegram bot   | —                                     |
| **2–3** | Full smoke: Move → Playground → Approve | **X product thread** + demo link      |
| **3**   | Create pump.fun coin (Phantom)          | Save mint; don’t spam it yet          |
| **4**   | Fix whatever broke in smoke             | Demo video reply                      |
| **5**   | Optional: token tweet (separate)        | pump link + disclaimer                |
| **6–7** | Tiny Base mainnet pay _or_ keep Sepolia | Metrics / “what broke” thread         |

---

## Personal checklist (only you can click)

### Product

- [ ] `ABI_KEK` and `ABI_KEY_PEPPER` securely backed up
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

| Doc                                 | Use                                                                        |
| ----------------------------------- | -------------------------------------------------------------------------- |
| **`docs/GO_LIVE.md`**               | **Zero-theory click path + YC 60s script — start here to finish the week** |
| **This file**                       | Launch orchestration (A–D)                                                 |
| `docs/DEPLOY.md`                    | Docker / VPS / CDP fund steps                                              |
| `docs/VERCEL.md`                    | vercel.app URL + harden                                                    |
| `contracts/README.md`               | Optional Base ERC-20 (not needed for pump.fun)                             |
| `docs/plans/abi-gtm-fundraising.md` | Why token ≠ product                                                        |

---

## Bottom line

1. **Go live the testnet product on Base Sepolia with disclosed self-custody + optional Telegram** — follow **`docs/GO_LIVE.md`**.
2. **Launch the community coin on Solana via pump.fun + Phantom** — no domain, no Base requirement.
3. **Market product first on X; token second** with a clear “not the console” line.

Week close = one policy-gated Sepolia pay with Settings showing the honest custody status. Everything else is optional.
