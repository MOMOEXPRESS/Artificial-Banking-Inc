# Deployment (zero-spend)

ABI is two services: a **persistent API** (SQLite + jobs) and a **console**
(Next.js on Vercel free). Never put secrets in the client bundle.

## Recommended free topology

| Piece | Free option | Notes |
| --- | --- | --- |
| Console | Vercel Hobby | Set `ABI_API_ORIGIN` to the API URL |
| API + worker + SQLite | Fly.io free allowance **or** Oracle Cloud free VM + `docker compose` | Needs a volume/disk |
| Keep-alive (optional) | [UptimeRobot](https://uptimerobot.com) free HTTP ping on `/health` | Avoids sleeper cold starts |
| Email | Leave unset (log stub) or Resend free tier later | Signup works; verification mail optional |
| Monitoring | stdout JSON logs (`pino`) + `GET /metrics` | No paid APM |

Render `starter` + disk works but **requires a card**. Render `free` sleeps and
cannot attach a disk — do not use it for a ledger you care about.

## 1. Generate secrets (local, free)

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Create **two different** values for `ABI_KEY_PEPPER` and `ABI_KEK`. Optionally
create `ABI_SIGNUP_TOKEN` for gated signup.

## 2. API on docker compose (Fly / Oracle / VPS)

```bash
export ABI_KEY_PEPPER=...
export ABI_KEK=...
export ABI_SIGNUP_TOKEN=...
docker compose up -d --build
curl -sS http://127.0.0.1:8787/health
curl -sS http://127.0.0.1:8787/ready
curl -sS http://127.0.0.1:8788/health   # worker
```

Compose sets `POLICYVAULT_ALLOW_BOOTSTRAP=0`, mock transfer off, and
`ABI_RUN_JOBS=0` on the API (worker owns jobs).

### Fly.io sketch (free allowance)

```bash
fly launch --no-deploy   # choose region, decline Postgres
fly volumes create abi_data --size 1
# set secrets: ABI_KEY_PEPPER ABI_KEK ABI_SIGNUP_TOKEN
fly deploy
```

Point health checks at `/health`; use `/ready` before sending traffic after deploys.

## 3. Console on Vercel (free)

1. Import the repo; root/directory = `apps/web` (or use the included `vercel.json`).
2. Env:
   - `ABI_API_ORIGIN=https://your-api.example`
   - `ABI_SIGNUP_TOKEN=` (same as API, server-only)
3. Deploy. Open the site → create an account via `/v1/auth/signup` (not demo bootstrap).

## 4. Production gates (automatic)

With `NODE_ENV=production` the API **refuses to boot** if:

- `ABI_KEY_PEPPER` or `ABI_KEK` missing
- `POLICYVAULT_ALLOW_BOOTSTRAP=1`
- `POLICYVAULT_ALLOW_PUBLIC_ORG_CREATE=1`
- `POLICYVAULT_MOCK_TRANSFER=1`
- `ABI_ALLOW_LOCAL_TARGETS=1`
- `ABI_DEMO_DERIVE_FROM_SIGNUP_TOKEN=1`

Disposable demos only: set `ABI_ALLOW_UNSAFE_PROD=1` **and** the demo flag you need. Never with real funds.

## 5. Verify

- `GET /health` → liveness
- `GET /ready` → SQLite ready; `demoMode` must be `false` in production
- Console login + MFA step-up path
- Sandbox/`base-sepolia` payment recorded in the ledger
- `npm run db:backup` scheduled on the API host (free cron)

## MCP server

The MCP server is **stdio** (no HTTP). Health = process alive + API reachable:

```bash
POLICYVAULT_API_URL=https://your-api.example POLICYVAULT_API_KEY=pv_agent_... \
  npm run start -w @policyvault/mcp-server
```

## See also

- [`docs/FREE-STACK.md`](./FREE-STACK.md) — free substitutes for paid services
- [`docs/GO_LIVE.md`](./GO_LIVE.md) — operator checklist
- [`docs/SECURITY.md`](./SECURITY.md) — security posture
