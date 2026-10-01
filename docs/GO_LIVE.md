# Go live — zero-theory click path

**Done when:** public console loads → API health is green → Settings shows the correct `CHAIN` and self-custody warning → vault has Sepolia USDC → an agent payment is allowed or approved once.

Longer context: `docs/LAUNCH.md`. This file is only the buttons.

---

## 0. Open the right URL

1. Vercel → your project → **Domains** → open Production URL
2. If you get a login wall: **Settings → Deployment Protection** → turn **Vercel Authentication** off
3. Bookmark that Domains URL (it may change after transferring off `gaia10`)

---

## 1. Production environment

Set API variables on the long-lived API host (for example, Render). The web
project only proxies requests and must not be given the API's encryption key.

| API host variable                          | Purpose                                                                           |
| ------------------------------------------ | --------------------------------------------------------------------------------- |
| `ABI_KEY_PEPPER`                           | Random secret for credential hashing                                              |
| `ABI_KEK`                                  | 32 random bytes, base64; encrypts vault keys at rest; back it up securely         |
| `CHAIN`                                    | `base-sepolia` for reviewed testnet flows                                         |
| `ABI_ONCHAIN_ENABLED`                      | Optional `1` to enable application-managed self-custody signing; not Coinbase CDP |
| `POLICYVAULT_ALLOW_BOOTSTRAP`              | `0` disables isolated demo org creation; set `1` only if desired                  |
| `POLICYVAULT_ALLOW_PUBLIC_ORG_CREATE`      | `1` enables public organization creation; leave off for invite-only deployment    |
| `RESEND_API_KEY` / `ABI_NOTIFY_EMAIL_FROM` | Email verification, reset, and invitation delivery                                |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID`  | Optional Telegram approvals                                                       |
| `TELEGRAM_ALLOWED_USER_IDS`                | Optional Telegram user allowlist                                                  |

On Vercel, set `ABI_API_ORIGIN` to the API's HTTPS URL. If registration is
gated, set the same `ABI_SIGNUP_TOKEN` on the API and Vercel; the browser never
receives it. Confirm service health, persistent disk, and email delivery in
their provider dashboards.

Restart or redeploy the API after changing its environment. Redeploy Vercel only
after changing its own proxy or registration-gate variables.

---

## 2. Verify custody and network (30 seconds)

1. Console → login as guardian
2. **Settings → Go live**
3. Environment card must show:
   - **Custody** = self-custodied / application-managed
   - **Network** = `base-sepolia` (or `base` if you flipped)
4. Confirm the warning says keys are encrypted with `ABI_KEK`, not managed by an HSM/MPC provider.

Managed Coinbase CDP custody is not implemented. `ABI_ONCHAIN_ENABLED=1` enables the application's self-custody signer. Legacy `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET` variables are accepted only as a compatibility toggle; ABI does not use them to authenticate with Coinbase.

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

### Prove x402 separately

Direct wallet pay and x402 API purchase are different rails. After the normal
smoke passes, follow [`X402-BASE-SEPOLIA-PROOF.md`](./X402-BASE-SEPOLIA-PROOF.md).
The proof is complete only when the facilitator returns a real transaction hash,
BaseScan shows the USDC transfer to the seller wallet, and the same hash appears
under Console → Transactions.

**Harder proof (real USDC to your wallet):** after Sync works, follow [`docs/E2E-ONCHAIN-AGENT-PAY.md`](./E2E-ONCHAIN-AGENT-PAY.md) — agent `pay` to an allowlisted Base Sepolia wallet broadcasts an ERC-20 Transfer from the vault. Use a Sepolia-capable wallet (not a Coinbase exchange deposit address).

---

## 6. Optional same-week extras (not blocking)

| Extra                 | Where                                                 |
| --------------------- | ----------------------------------------------------- |
| Solana community coin | `docs/LAUNCH.md` Track C — pump.fun + Phantom         |
| X product thread      | `docs/LAUNCH.md` Track D — **no token in first post** |
| Base mainnet          | Flip `CHAIN=base`, fund mainnet USDC, tiny pay        |

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
4. **45–60s** — Settings Go live: Base Sepolia and the honest self-custody status. “Not a bank — controls.” End on the public demo URL.

No Postgres required. SQLite already holds orgs / agents / policies / ledger. Idea-stage + working demo is enough to apply.

---

## Personal checklist (print / tick)

- [ ] Domains URL loads without Vercel login wall
- [ ] Env: pepper, KEK, bootstrap=`0`, `CHAIN` → Redeploy
- [ ] Settings: self-custody warning is visible; network matches `CHAIN`
- [ ] Vault funded with network USDC
- [ ] Move → stipend funded
- [ ] Playground pay → Approve once
- [ ] (Optional) Telegram approve
- [ ] (Optional) X product thread
- [ ] (Optional) YC video from steps 4–5

When all product boxes are ticked, the week is closed. Token and X are marketing, not go-live.
