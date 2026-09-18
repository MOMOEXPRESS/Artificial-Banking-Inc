# Deploy Artificial Banking Inc (API + Console)

## The one thing to understand first

**Two processes, always.** The console (Next.js) and the API (Express) are
separate, and the console is useless without the API.

The API is long-lived: it owns a database connection and runs background sweeps
— subscriptions, escrow timeouts, approval expiry, on-chain deposit detection,
treasury reconciliation. It used to be embedded in the Next app on Vercel, and
that lost writes under concurrency and never ran a single sweep. See
[`docs/adr/2026-07-26-persistent-api-over-serverless.md`](adr/2026-07-26-persistent-api-over-serverless.md).

So: Vercel can host the console. Vercel cannot host the API. If you see

> `No ABI API origin is configured. Set ABI_API_ORIGIN…`

it means the console is deployed and has not been told where the API lives.

---

## Local development

```bash
npm install
npm run dev
```

That runs both processes. Console on <http://localhost:3000>, API on
<http://localhost:8787/health>. The console's `/abi-api` proxy falls back to
`http://127.0.0.1:8787` automatically when `ABI_API_ORIGIN` is unset and it is
not running on Vercel, so local needs no configuration at all.

Two terminals also works, if you prefer:

```bash
npm run dev:api
npm run dev:web
```

---

## Vercel (console) + a hosted API

### 1. Deploy the API somewhere that can run a process

Any of Render, Railway, Fly.io, or a VPS. The repo ships a blueprint for Render:

```
Render dashboard → New → Blueprint → select this repo
```

It reads [`render.yaml`](../render.yaml), builds the API target from the
existing `Dockerfile`, and mounts a disk at `/data` for the SQLite database.

**The disk is not optional.** Without a persistent volume the database lives in
the container filesystem, and every deploy silently resets your orgs, guardian
keys and ledger. On most hosts a disk means a paid instance.

Set these secrets on the API service (the blueprint marks them `sync: false`,
so Render prompts you):

| Variable | How to get it |
|---|---|
| `ABI_KEK` | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` — **back this up; lose it and every vault key is unrecoverable** |
| `ABI_KEY_PEPPER` | Same generator, different value |
| `ABI_SIGNUP_TOKEN` | Same generator. Org creation and demo seeding refuse to serve without it in production. **Set the same value on the Vercel project too** — the console attaches it server-side in the `/abi-api` proxy, and without it "Create organization" fails with `Missing or invalid x-abi-signup-token` |
| `ABI_CONSOLE_URL` | Your Vercel URL, e.g. `https://abi.vercel.app` |
| `ABI_CORS_ORIGINS` | Same Vercel URL |
| `CHAIN_RPC_URL` | A paid Base RPC (Alchemy/Infura/QuickNode) |

Confirm it is up: `curl https://your-api.onrender.com/health`

### 2. Point Vercel at it

In the Vercel project → **Settings → Environment Variables**:

| Variable | Value |
|---|---|
| `ABI_API_ORIGIN` | `https://your-api.onrender.com` — no trailing slash, no `/v1` |
| `ABI_SIGNUP_TOKEN` | The same value you set on the API. Server-side only — never `NEXT_PUBLIC_` |
| `NEXT_PUBLIC_API_URL` | `/abi-api` (the default; the console calls same-origin and the proxy forwards) |

Redeploy. `ABI_API_ORIGIN` is read at request time by a server-side route, but
Vercel only exposes new environment variables to a new deployment.

### 3. Check it

```bash
curl https://your-console.vercel.app/abi-api/health
```

`{"ok":true,"service":"abi-api"}` means the whole path works. A 503 means
`ABI_API_ORIGIN` is still unset on Vercel; a 502 means it is set but the API
is unreachable at that URL.

### 4. Generate the env block (copy-paste)

```bash
node scripts/print-deploy-env.mjs \
  --console-url https://your-console.vercel.app \
  --api-url https://your-api.onrender.com
```

That prints two groups. Paste the first onto the API service, the second onto
the Vercel project, then **redeploy both**. Environment variables only apply
to a new deployment.

Probe afterwards:

```bash
node scripts/check-login-api.mjs https://your-console.vercel.app
```

A healthy login path returns **401** for dummy credentials (`UNAUTHORIZED` /
"Email or password is incorrect.") — that means the API is up, hashing works,
and the proxy is forwarding. HTTP 200 on dummy creds would be the bug.

---

## Login API errors (what they actually mean)

These are the failures the console surfaces as "Sign in failed". They are
almost never a wrong password on a working stack — they are deploy/env.

| What you see | What it is | What to set / do |
|---|---|---|
| `x-vercel-error: DEPLOYMENT_NOT_FOUND` or platform 404 | No live Vercel deployment, or the wrong `*.vercel.app` hostname | Redeploy Production from `main`. Root Directory = `apps/web`. Bookmark the URL under **Domains**, not `artificial-banking-inc.vercel.app` (unassigned on team projects) |
| Vercel login wall / `vercel.com/login` | Deployment Protection SSO | Settings → Deployment Protection → off, or `VERCEL_TOKEN=… npm run vercel:harden` |
| `API_NOT_CONFIGURED` / HTTP 503 | Console deployed, `ABI_API_ORIGIN` missing | Vercel env: `ABI_API_ORIGIN=https://your-api.onrender.com` (no trailing slash, no `/v1`). Redeploy |
| `API_UNREACHABLE` / HTTP 502 | Origin set, API process down | Start/redeploy the Render (or Railway/Fly) API. `curl $ABI_API_ORIGIN/health` |
| `Email or password is incorrect.` on a known-good account | SQLite was wiped (no persistent disk) **or** genuinely wrong password | Render disk at `/data` is required. Redeploying without it resets every user |
| `Missing or invalid x-abi-signup-token` on Create org / Demo | `ABI_SIGNUP_TOKEN` missing or different between Vercel and the API | Same value on both. Console attaches it server-side for `/v1/demo/bootstrap` and `/v1/guardian/orgs` |
| `Signed in, but the session cookie did not stick` | Proxy reached the API but `Set-Cookie` never made it to the browser | Confirm the console calls same-origin `/abi-api` (`NEXT_PUBLIC_API_URL=/abi-api`). If you call the API host directly from the browser, set `ABI_CORS_ORIGINS` to the console URL |
| HTTP 400 `VALIDATION_ERROR` on login | Email failed Zod (`email: Invalid email`) | Real validation, not an outage |

### Vercel (console) — required

| Variable | Value |
|---|---|
| `ABI_API_ORIGIN` | API origin, e.g. `https://abi-api.onrender.com` |
| `ABI_SIGNUP_TOKEN` | Same random string as the API. Server-side only — never `NEXT_PUBLIC_` |
| `NEXT_PUBLIC_API_URL` | `/abi-api` |

### API host (Render / Railway / Fly / VPS) — required

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `ABI_KEK` | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` — **back up; lose it and vault keys are gone** |
| `ABI_KEY_PEPPER` | Same generator, different value |
| `ABI_SIGNUP_TOKEN` | Same generator, **identical** to Vercel |
| `ABI_CONSOLE_URL` | Public console URL (password-reset links) |
| `ABI_CORS_ORIGINS` | Same console URL |
| `POLICYVAULT_DB` | `/data/policyvault.db` on a persistent disk |
| `POLICYVAULT_ALLOW_BOOTSTRAP` | `0` |
| `POLICYVAULT_ALLOW_PUBLIC_ORG_CREATE` | `0` |
| `ABI_RUN_JOBS` | `1` unless a separate worker owns sweeps |
| `CHAIN` | `base-sepolia` (or `base`) |
| `CHAIN_RPC_URL` | Paid Base RPC |

Redeploy order: **API first** (so `/health` is green), then **Vercel** (so it picks up `ABI_API_ORIGIN`). Then `node scripts/check-login-api.mjs <console-url>`.

### Why not just run the API on Vercel?

Because it was, and it was wrong. Serverless functions are frozen between
requests, so no background job ever ran: recurring payments never charged,
escrow never timed out, deposits were never detected. And the SQLite-over-blob
persistence lost writes whenever two requests overlapped — including writes
that recorded real USDC leaving a vault.

---

## Architecture

```
Internet → reverse proxy (Caddy/Nginx/Cloudflare)
              ├── yourdomain.com      → web (:3000)  Next.js Console
              └── api.yourdomain.com  → api (:8787)  Express Financial OS
```

**Database today:** SQLite file at `POLICYVAULT_DB` (default `apps/api/data/policyvault.db`).  
One volume is enough for a single-node VPS. Durable, simple, correct for the money spine.

**Postgres:** Compose includes an optional `postgres` profile for the future A14 Prisma swap. Do **not** point the live API at Postgres until `store.ts` is reimplemented — flipping `DATABASE_URL` alone does nothing.

**Servers:** Yes — you need at least the **api** process and the **web** process (or a static export of web behind the same host). MCP/worker are optional sidecars.

## Quick start (Docker)

```bash
cp .env.example .env
# set ABI_KEY_PEPPER, NEXT_PUBLIC_API_URL=https://api.yourdomain.com
docker compose up -d --build
```

- Console: http://localhost:3000  
- API health: http://localhost:8787/health  
- Prometheus: http://localhost:8787/metrics  

## Go-live checklist (money)

1. Set a strong `ABI_KEY_PEPPER` (A13 key hashing).
2. Set `ABI_KEK` (required — vault keys are encrypted at rest under it). Note that `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET` do **not** enable Coinbase custody: there is no Coinbase integration in this codebase, and both providers hold the key in this process. See [`SECURITY.md`](SECURITY.md).
3. Open Console → Treasury → Fund → copy vault address → send USDC on Base Sepolia (or Base if `CHAIN=base`).
4. Set `POLICYVAULT_ALLOW_BOOTSTRAP=0` and `POLICYVAULT_ALLOW_PUBLIC_ORG_CREATE=0` on production (demo seeding and anonymous org creation both hand out credentials).
5. Optional ops: `SLACK_WEBHOOK_URL`, `RESEND_API_KEY` + `ABI_NOTIFY_EMAIL_TO`.
6. Optional compliance: `ABI_COMPLIANCE_DENYLIST`, `ABI_COMPLIANCE_WEBHOOK_URL`.

## Domain + TLS (example Caddy)

```caddy
yourdomain.com {
  reverse_proxy web:3000
}
api.yourdomain.com {
  reverse_proxy api:8787
}
```

Point DNS A/AAAA records at the VPS. Set `NEXT_PUBLIC_API_URL=https://api.yourdomain.com` at **build** time for the web image.

## Without Docker

```bash
npm install
npm run build
POLICYVAULT_DB=/var/lib/abi/policyvault.db ABI_KEY_PEPPER=… node apps/api/dist/index.js
NEXT_PUBLIC_API_URL=https://api.yourdomain.com npm run start -w @policyvault/web
```

Use systemd (or PM2) for both processes; put Caddy/Nginx in front.

## What “live website.com” means here

| Piece | Required? | Notes |
|-------|-----------|-------|
| Public domain + TLS | Yes | Console + API hostnames |
| API server | Yes | Money spine |
| Web server | Yes | Guardian Console |
| SQLite volume / disk | Yes | Default DB |
| Postgres | Optional | Future A14 |
| CDP credentials | For on-chain settle | Else DevLocal demo |
| Email/Slack | Recommended | HITL alerts |

## Security notes

- Guardian / agent / session secrets are **hashed at rest** (`h1:sha256`). Reveal-once on create/rotate.
- Never commit `.env`. Rotate `ABI_KEY_PEPPER` only with a planned re-issue of all keys (hashes become unverifiable).
- Viewer role is read-only; keep owner keys offline after bootstrap.
