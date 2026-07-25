# YC 60s video — founder + agent handoff

**Split of work (approved)**

| Who | What |
|-----|------|
| **You** | Face VO for the full ~60s (talk track below). CapCut edit. Optional Nano Banana polish + Runway abstract transitions. |
| **Agent** | Silent console B-roll, stills, title/end cards, shot list. Local record only. |

---

## Record targets (confirmed 2026-07-25)

| Target | Status |
|--------|--------|
| Production `https://artificial-banking-inc-gaia10.vercel.app` | **HTTP 404** (Vercel `NOT_FOUND`) — do **not** use for tape until Domains alias is fixed |
| Local `http://127.0.0.1:3000` | **OK** — console + `/abi-api` proxy + demo bootstrap |
| API `http://127.0.0.1:8787/health` | **OK** |

**Before you submit YC:** fix Vercel Production Domains so the company URL in the form loads without 404. Tape from local is fine for the video; the application link must work.

---

## Your 60s face talk track (you record)

From `docs/GO_LIVE.md` — speak to camera (or picture-in-picture over B-roll):

1. **0–10s** — “Agents will spend. We put brakes between the model and the money.”
2. **10–25s** — Vault → budget → agent stipend (money path).
3. **25–45s** — Agent pays under policy → Approvals → you Approve.
4. **45–60s** — Custody on Base / USDC, “not a bank — controls.” End.

One-liner:

> Artificial Banking Inc: policy-controlled USDC wallets for AI agents — budgets, stipends, and human approval before spend.

---

## CapCut assemble order (recommended)

1. **Title card** (`yc-title-card.png`) — 1.5–2s, soft fade  
2. **Optional** Runway / CapCut dissolve using `yc-transition-plate-abstract.png` (~0.5–1s)  
3. **Login / brand beat** — silent B-roll clip A  
4. **Overview + Treasury** — clip B  
5. **Playground → Approvals** — clip C (hero moment)  
6. **Optional** second abstract transition plate  
7. **Settings / Go live beat** — clip D (or freeze still)  
8. **End card** (`yc-end-card.png`) — 2s  
9. Lay **your VO** under 3–8; duck any UI noise to silent  

**Nano Banana (optional):** restyle title/end cards or generate one more abstract plate if you want a stronger brand match — keep text legible for YC reviewers.

**Runway (optional):** Gen-3 / motion brush on the abstract plate only for transitions — keep console footage as real product UI (do not AI-fake the console).

---

## Silent console capture checklist (agent path)

URL: `http://127.0.0.1:3000/console` (or `?demo=1` if wired)

1. Skip vault intro → **Demo** → Launch demo org → ack keys → Enter console  
2. **Overview** — pause on org float / agents  
3. **Treasury** — vault / move / stipend path (honest copy: ledger vs on-chain)  
4. **Playground** — run a pay / mission that hits policy  
5. **Approvals** — approve once  
6. **Settings** — custody / network / not-a-bank  

Artifacts land under `/opt/cursor/artifacts/yc-video/` and `/opt/cursor/artifacts/assets/`.

---

## Artifact index (agent-produced)

**Cloud agent artifacts** (download from the agent run / PR media):

| Path | Use |
|------|-----|
| `/opt/cursor/artifacts/yc-video/yc-title-card.png` | Open |
| `/opt/cursor/artifacts/yc-video/yc-end-card.png` | Close |
| `/opt/cursor/artifacts/yc-video/yc-transition-plate-abstract.png` | Runway / CapCut transition |
| `/opt/cursor/artifacts/yc-console-walkthrough-silent.mp4` | Main silent B-roll (~55s clean nav; trim already applied — ends on Overview) |
| `/opt/cursor/artifacts/yc-video/console-walkthrough.mp4` | Same file, folder copy |
| `/opt/cursor/artifacts/yc-video/stills/00-homepage.webp` … `06-overview-end.webp` | Cutaways |

**Also in this folder (repo):** title/end/transition PNGs + named stills + this handoff.

### Capture notes (2026-07-25)

- Demo bootstrap OK on local; clean take: Homepage → Overview → Treasury → Playground (no run) → Payments→Approvals → Settings → Overview.
- Cursor recorder appends a ~2s brand cube at the end — **already trimmed** from the delivered MP4 (~54.5s).
- Approvals inbox empty in this take — for a HITL Approve beat, locally run **“Large purchase (needs your approval)”** in Playground and re-cut 5–8s, or VO over Playground spend steps.
- Local Settings showed `custody: dev-local` / `settlement: mock` — say “Base Sepolia / USDC controls” in VO; fix Domains + CDP before calling production live in the form.

---

## Do not put in the YC form video

- Long key-reveal scrolling  
- Demo wipe warnings as the hero message  
- Fake “bank” language  
- Broken production 404 screen  
