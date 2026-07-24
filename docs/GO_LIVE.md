# Go live — zero-theory click path

**Done when:** public console loads → Settings shows custody `cdp` + your `CHAIN` → vault has Sepolia USDC → Playground pay → you Approve once.

Longer context: `docs/LAUNCH.md`. This file is only the buttons.

---

## 0. Open the right URL

1. Vercel → your project → **Domains** → open Production URL  
2. If you get a login wall: **Settings → Deployment Protection** → turn **Vercel Authentication** off  
3. Bookmark that Domains URL (it may change after transferring off `gaia10`)

---

## 1. Production env (Vercel → Settings → Environment Variables → Production)

| Key | Value |
| --- | --- |
| `ABI_KEY_PEPPER` | long random string (required) |
| `POLICYVAULT_ALLOW_BOOTSTRAP` | `0` |
| `POLICYVAULT_ALLOW_PUBLIC_ORG_CREATE` | `1` (so login **Create org** works; set `0` later if you want invite-only) |
| `CHAIN` | `base-sepolia` |
| `CDP_API_KEY_ID` | from [Coinbase Developer Platform](https://portal.cdp.coinbase.com/) |
| `CDP_API_KEY_SECRET` | same portal — **both** required |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | optional |
| `TELEGRAM_ALLOWED_USER_IDS` | optional lock |

Then **Deployments → … → Redeploy** (env only applies after a new deploy).

---

## 2. Prove CDP is live (30 seconds)

1. Console → login as guardian  
2. **Settings → Go live**  
3. Environment card must show:
   - **Custody** = `cdp`  
   - **Network** = `base-sepolia` (or `base` if you flipped)  
4. Checklist row “Real custody (Coinbase CDP)” is green  

If still `dev-local`: both CDP keys missing or redeploy not done. Fix env → Redeploy → hard refresh.

---

## 3. Fund the vault

1. **Settings → Go live → Organisation** (or **Treasury → Vault**) → copy **vault address**  
2. Send **Base Sepolia USDC** to that address (Circle faucet or CDP faucet — network must be Base Sepolia)  
3. Console → **Treasury → Fund** → open the tab (auto-credits Transfer-ins; Refresh if needed). Optional **Force re-scan**.  
4. Confirm Transfer-in rows show tx links on Basescan  

Product money = **USDC**. Do not put a Solana meme token here.  
**Receive (demo ledger)** is still available for offline demos without a faucet.

---

## 4. Move money inside the product

1. **Treasury → Move**  
2. Intent order (typical first smoke):
   1. Fill a budget from vault  
   2. Fund an agent stipend from that budget  
3. Confirm Overview / Wallets show the agent has stipend  

---

## 5. Force one HITL approval

1. **Playground** → small mission that pays (or Chat that triggers a pay under policy)  
2. Open **Approvals** — pending item appears  
3. **Approve** in console (or Telegram if wired)  
4. Check **Activity** / ledger — journal looks sane  

That single approved pay is the week’s definition of “live.”

**Harder proof (real USDC to your wallet):** after Sync works, follow [`docs/E2E-ONCHAIN-AGENT-PAY.md`](./E2E-ONCHAIN-AGENT-PAY.md) — agent `pay` to an allowlisted Base Sepolia wallet broadcasts an ERC-20 Transfer from the vault. Use a Sepolia-capable wallet (not a Coinbase exchange deposit address).

---

## 6. Optional same-week extras (not blocking)

| Extra | Where |
| --- | --- |
| Solana community coin | `docs/LAUNCH.md` Track C — pump.fun + Phantom |
| X product thread | `docs/LAUNCH.md` Track D — **no token in first post** |
| Base mainnet | Flip `CHAIN=base`, fund mainnet USDC, tiny pay |

---

## YC one-liner + 60s video (if applying)

**Full draft answers:** [`docs/YC-APPLICATION.md`](./YC-APPLICATION.md)  
**Apply:** https://www.ycombinator.com/apply — Fall 2026 on-time deadline **July 27, 8pm PT**.

**One-liner**

> Artificial Banking Inc: policy-controlled USDC wallets for AI agents — budgets, stipends, and human approval before spend.

**60-second talk track (screen-record the console)**

1. **0–10s** — Homepage / console login: “Agents will spend. We put brakes between the model and the money.”  
2. **10–25s** — Overview → Treasury Move: vault → budget → agent stipend.  
3. **25–45s** — Playground pays → Approvals lights up → you Approve.  
4. **45–60s** — Settings Go live: custody `cdp`, Base Sepolia, “not a bank — controls.” End on public demo URL.

No Postgres required. SQLite already holds orgs / agents / policies / ledger. Idea-stage + working demo is enough to apply.

---

## Personal checklist (print / tick)

- [ ] Domains URL loads without Vercel login wall  
- [ ] Env: pepper, bootstrap=`0`, `CHAIN`, both CDP keys → Redeploy  
- [ ] Settings: custody `cdp`, network matches `CHAIN`  
- [ ] Vault funded with network USDC  
- [ ] Move → stipend funded  
- [ ] Playground pay → Approve once  
- [ ] (Optional) Telegram approve  
- [ ] (Optional) X product thread  
- [ ] (Optional) YC video from steps 4–5  

When all product boxes are ticked, the week is closed. Token and X are marketing, not go-live.
