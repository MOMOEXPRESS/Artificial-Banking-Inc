# Deployment (zero-spend)

ABI is two services: a **persistent API** (SQLite + jobs) and a **console**
(Next.js on Vercel free). Never put secrets in the client bundle.

## Production topology (free)

| Piece      | Host                                              | Notes                                                                 |
| ---------- | ------------------------------------------------- | --------------------------------------------------------------------- |
| Console    | Vercel Hobby                                      | `ABI_API_ORIGIN` = the Worker URL                                     |
| API + data | Cloudflare Workers Free + SQLite Durable Object   | `apps/api-worker`; see [CLOUDFLARE-WORKERS.md](CLOUDFLARE-WORKERS.md) |
| Email      | Resend HTTP API (`RESEND_API_KEY` Worker secret)  | Brevo (`BREVO_API_KEY`) is preferred only when set                    |
| Monitoring | Workers Logs (`[observability]`) + `GET /metrics` | No paid APM                                                           |

Self-hosting the Node API with `docker compose` (below) remains possible for local or VPS use.

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

## API email (required for production signup)

On the API host, configure **Brevo (primary, free)** or an optional fallback, plus the console origin:

| Variable                        | Notes                                                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `BREVO_API_KEY`                 | **Recommended free path** — Brevo transactional HTTP API (`fetch`). Free plan: verify one sender email, no custom domain |
| `ABI_NOTIFY_EMAIL_FROM`         | That verified sender, e.g. `you@gmail.com` or `ABI <you@gmail.com>`                                                      |
| `ABI_CONSOLE_URL`               | Public console origin for verification/invite/reset links — **required in production** (no localhost fallback)           |
| `RESEND_API_KEY`                | Optional fallback only. Free Resend without a domain only delivers to the account owner                                  |
| `SMTP_*`                        | Optional Node SMTP path (e.g. `smtp-relay.brevo.com:587`) if not using `BREVO_API_KEY`                                   |
| `ABI_ALLOW_UNVERIFIED_SIGNUP=1` | Opt-in testnet-only escape hatch; refused when `CHAIN=base`. Default off                                                 |

Email is not optional for production signup unless that testnet flag is set.

### Brevo free setup (optional — Worker secrets)

1. Create a free Brevo account and verify **one sender email** (Senders — no domain required).
2. Create an API key (SMTP & API → API keys).
3. On the Worker set (`npx wrangler secret put BREVO_API_KEY --config ./wrangler.toml` from `apps/api-worker`):
   - `BREVO_API_KEY=<api-key>`
   - `ABI_NOTIFY_EMAIL_FROM=ABI <your-verified-sender@example.com>`
   - `ABI_CONSOLE_URL=https://artificial-banking-inc-web.vercel.app` (or your console URL)

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

## SQLite backup and restore drill

For a self-hosted SQLite API, `npm run db:backup` takes a transactionally
consistent snapshot with SQLite's online backup API and runs `PRAGMA
quick_check` against the copy. It writes under `backups/` by default; set
`ABI_BACKUP_DIR` to the mounted backup volume. The output file is created with
owner-only permissions. Schedule this on the API host and encrypt/replicate the
volume using the host's secret-management and backup service; a local file is
not a durable off-site backup.

To rehearse a restore, stop a staging API, copy the selected backup to an
isolated staging data path, set `POLICYVAULT_DB` to that path, start the API,
and run the reconciliation endpoint before any test payments. Keep the source
and backup copies until the restored ledger and account counts match. Do not
restore over production as part of a drill.

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
