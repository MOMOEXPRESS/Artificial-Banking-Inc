# Deploy Artificial Banking Inc (API + Console)

This is the production path after pillars are depth-complete.

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
2. Set `CDP_API_KEY_ID` + `CDP_API_KEY_SECRET` → custody provider becomes `cdp` behind the **existent vault address**.
3. Open Console → Treasury → Fund → copy vault address → send USDC on Base Sepolia (or Base if `CHAIN=base`).
4. Set `POLICYVAULT_ALLOW_BOOTSTRAP=0` on production (demo wipe disabled).
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
