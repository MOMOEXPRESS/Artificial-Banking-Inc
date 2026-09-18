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

Generate the three secrets once:

```bash
npm run env:secrets
```

It prints paste-ready `KEY=value` lines, grouped by the host each belongs on.
Nothing is written to disk. **Back `ABI_KEK` up before the first deploy** —
every vault private key is encrypted under it, and there is no recovery.

Set these on the API service (the blueprint marks them `sync: false`, so Render
prompts you). Everything else in `render.yaml` already has the right value.

| Variable | Required | Value |
|---|---|---|
| `ABI_KEK` | **Yes** — the API refuses to boot in production without it | From `npm run env:secrets` |
| `ABI_KEY_PEPPER` | **Yes** | From `npm run env:secrets` |
| `ABI_SIGNUP_TOKEN` | **Yes** — "Create account", "Create organization" and demo seeding refuse to serve without it in production | From `npm run env:secrets`. **Set the same value on the Vercel project too** |
| `ABI_CONSOLE_URL` | **Yes** | Your Vercel URL, e.g. `https://abi.vercel.app` — password-reset links point here |
| `ABI_CORS_ORIGINS` | Yes if anything other than the `/abi-api` proxy will call the API with cookies | Same Vercel URL. Leave empty otherwise |
| `CHAIN_RPC_URL` | Recommended | A paid Base RPC (Alchemy/Infura/QuickNode). Public RPCs drop log ranges |
| `NODE_ENV` | set by blueprint | `production` |
| `PORT` | set by blueprint | `8787` |
| `POLICYVAULT_DB` | set by blueprint | `/data/policyvault.db` — on the mounted disk |
| `ABI_RUN_JOBS` | set by blueprint | `1` (this process owns the background sweeps) |
| `POLICYVAULT_ALLOW_BOOTSTRAP` | set by blueprint | `0` |
| `POLICYVAULT_ALLOW_PUBLIC_ORG_CREATE` | set by blueprint | `0` |
| `ABI_ALLOW_LOCAL_TARGETS` | set by blueprint | `0` |
| `CHAIN` | set by blueprint | `base-sepolia` (or `base` for mainnet) |
| `RESEND_API_KEY`, `ABI_NOTIFY_EMAIL_TO` | Optional | Without them password-reset emails are only logged, and the console cannot show the link in production |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `SLACK_WEBHOOK_URL` | Optional | Approval notifications |

Confirm it is up: `curl https://your-api.onrender.com/health`

### 2. Point Vercel at it

In the Vercel project → **Settings → Environment Variables** (Production, and
Preview if you use preview deploys):

| Variable | Required | Value |
|---|---|---|
| `ABI_API_ORIGIN` | **Yes** | `https://your-api.onrender.com` — no trailing slash, no `/v1` |
| `ABI_SIGNUP_TOKEN` | **Yes** | The **same** value you set on the API. Server-side only — never `NEXT_PUBLIC_` |
| `NEXT_PUBLIC_API_URL` | No | `/abi-api` is the default; only set it if you need to override |

Then redeploy. `ABI_API_ORIGIN` is read at request time by a server-side route,
but Vercel only exposes new environment variables to a new deployment.

### 3. Check it

```bash
curl https://your-console.vercel.app/abi-api/health
```

`{"ok":true,"service":"abi-api"}` means the whole path works. A 503 means
`ABI_API_ORIGIN` is still unset on Vercel; a 502 means it is set but the API
is unreachable at that URL.

Then check sign-in specifically. Both of these must come back as JSON:

```bash
# Well-formed, wrong credentials → 401, same body whether or not the account exists.
curl -s -X POST https://your-console.vercel.app/abi-api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"probe@example.com","password":"not-a-real-password"}'
# {"error":{"code":"UNAUTHORIZED","message":"Email or password is incorrect."}}

# Malformed → 400, and the API is still up afterwards.
curl -s -X POST https://your-console.vercel.app/abi-api/v1/auth/login \
  -H 'content-type: application/json' -d '{"email":"bob"}'
# {"error":{"code":"VALIDATION_ERROR","message":"email: Invalid email; password: Required"}}
curl -s https://your-api.onrender.com/health
```

If the second request returns an empty reply and the health check fails right
after it, the API is running a build from before the fix described under
**Sign-in errors** below. Redeploy it.

### Redeploying

You need a redeploy after changing environment variables, and after every
merge to `main` that is not picked up automatically.

**API on Render**

1. Render dashboard → the `abi-api` service → **Environment**. Add or change
   the variables, **Save Changes**. Render redeploys automatically on an
   environment change.
2. For a code update without an env change: **Manual Deploy → Deploy latest
   commit**. Use **Clear build cache & deploy** if the Dockerfile or a
   dependency changed.
3. Watch **Logs** for `ABI API on http://localhost:8787` and no stack trace
   after it. A boot-time refusal about `ABI_KEK` means step 1 is incomplete.
4. `curl https://your-api.onrender.com/health` → `{"ok":true,…}`.

The disk at `/data` survives redeploys; the database is not reset.

**Console on Vercel**

1. Vercel → project → **Settings → Environment Variables**. Set
   `ABI_API_ORIGIN` and `ABI_SIGNUP_TOKEN` for the **Production** environment.
2. **Deployments** → newest **Production** row → **⋯ → Redeploy**. Untick
   *Use existing Build Cache* if a dependency changed.
3. Make sure the row you redeploy is the commit you expect. Redeploying an old
   row rebuilds that old commit — see [`VERCEL.md`](VERCEL.md).
4. `curl https://your-console.vercel.app/abi-api/health`.

Order matters when both change: deploy the API first, then the console, so the
console never points at an origin that is not serving yet.

### Sign-in errors, decoded

What the console shows on **Sign in**, what it means, and what to do.

| Console shows | API / proxy returned | Cause | Fix |
|---|---|---|---|
| *This console has no API to talk to…* | 503 `API_NOT_CONFIGURED` | `ABI_API_ORIGIN` unset on Vercel | Set it, redeploy the console |
| *Could not reach the ABI API at https://…* | 502 `API_UNREACHABLE` | API down, wrong URL, or still booting | `curl <api>/health`; check Render logs; fix the URL (no trailing slash) |
| *Email or password is incorrect.* | 401 `UNAUTHORIZED` | Wrong credentials, or the account is disabled | Use **Forgot your password?** — needs `ABI_CONSOLE_URL` on the API and, in production, an email provider |
| *email: Invalid email…* | 400 `VALIDATION_ERROR` | Malformed request body | Correct the input; this is the expected answer |
| *Sign up failed: … x-abi-signup-token* | 403 `UNAUTHORIZED` | `ABI_SIGNUP_TOKEN` missing on Vercel, or differs from the API's | Set the same value on both, redeploy the console |
| *Self-serve organization creation requires ABI_SIGNUP_TOKEN…* | 403 `UNAUTHORIZED` | `ABI_SIGNUP_TOKEN` unset on the **API** in production | Set it on the API |
| *Sign in failed: TypeError: Failed to fetch* / *Empty reply* | no response | **API process crashed mid-request** | See below — redeploy the API on a build that includes the fix |
| Signed in, then immediately signed out on reload | cookie not stored | Console served over `http://` in production (`Secure` cookies are dropped), or the API is called cross-origin without `ABI_CORS_ORIGINS` | Serve over HTTPS; call the API through the same-origin `/abi-api` proxy |
| Signed in (200), then every call is 401 | session TTL is zero | `ABI_SESSION_TTL_HOURS` set to `""`, `0`, or garbage — older builds minted an instantly-expired cookie | Leave it unset (defaults to 12), or set a positive number; redeploy the API |
| *Over N requests/minute* | 429 `RATE_LIMITED` | Per-IP limiter | Wait, or raise `RATE_LIMIT_PER_MIN` |

**The crash.** Builds before this fix ran the `/v1/auth/login`, `/v1/auth/signup`,
`/v1/auth/change-password`, `/v1/auth/mfa/disable`, `/v1/auth/step-up` and
`/v1/auth/password-reset/confirm` handlers as bare `async` functions under
Express 4, which does not observe the returned promise. A request body that
failed validation — an email without an `@`, a missing password — threw inside
the handler, the rejection was never caught, and Node exited the process. One
typo in the sign-in form took the API down for everyone until the host
restarted it; every in-flight request got an empty reply. Those handlers now
route rejections to the JSON error handler and answer 400. The regression
tests are in `apps/api/src/auth/identity.test.ts` (*malformed auth requests*).

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
