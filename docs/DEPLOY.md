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
| `ABI_SIGNUP_TOKEN` | Same generator. Org creation refuses to serve without it in production |
| `ABI_CONSOLE_URL` | Your Vercel URL, e.g. `https://abi.vercel.app` |
| `ABI_CORS_ORIGINS` | Same Vercel URL |
| `CHAIN_RPC_URL` | A paid Base RPC (Alchemy/Infura/QuickNode) |

Confirm it is up: `curl https://your-api.onrender.com/health`

### 2. Point Vercel at it

In the Vercel project → **Settings → Environment Variables**:

| Variable | Value |
|---|---|
| `ABI_API_ORIGIN` | `https://your-api.onrender.com` — no trailing slash, no `/v1` |
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
