# Cloudflare Workers (ABI API — production)

`apps/api` runs on Cloudflare Workers Free inside one SQLite-backed Durable
Object. This is the production API (`https://abi-api.<subdomain>.workers.dev`);
the Vercel console proxies to it through `/abi-api`.

## Architecture

1. Thin Worker `fetch` forwards every request to a singleton Durable Object (`AbiApi`).
2. The DO injects a better-sqlite3-shaped adapter over `ctx.storage.sql`, then
   dynamically imports the Express app (`@policyvault/api/worker-app`).
   Data is durable Durable Object SQLite storage (survives deploys and restarts).
3. Express is served through `cloudflare:node` (`handleAsNodeRequest`).
4. Background work runs on a **~60s Durable Object alarm** (no `setInterval`, no job leases).
5. Remote MCP calls the API through an in-process Node HTTP bridge (no `127.0.0.1` loopback).
6. Outbound SSRF checks resolve DNS via **DNS-over-HTTPS**; Node can dial the pinned IP.
7. `applyWorkerEnv` forces `NODE_ENV=production`, so the production guards in
   `apps/api/src/config.ts` apply (pepper/KEK required, demo flags refused).

## Package layout

| Path                          | Role                                                    |
| ----------------------------- | ------------------------------------------------------- |
| `apps/api-worker/`            | Wrangler project, DO class, SQL shim, vitest pool tests |
| `apps/api/src/worker-app.ts`  | Express export + alarm runner entry                     |
| `apps/api/src/storage` seams  | Lazy/`injectStoreDatabase` in `store.ts`                |
| `apps/api/src/dns-resolve.ts` | DoH resolver (Workers-safe)                             |
| `docs/CLOUDFLARE-WORKERS.md`  | This file                                               |

## Free-plan notes

| Quota                | Limit                 | ABI note                                                                  |
| -------------------- | --------------------- | ------------------------------------------------------------------------- |
| Worker / DO requests | 100k/day              | Console polling ~48 req/min ≈ 69k/day per open tab                        |
| DO CPU / request     | **30 s** (documented) | scrypt ~40–50 ms — must run **inside the DO**, not a plain Worker (10 ms) |
| DO duration          | 13k GB-s/day          | Prefer alarms + hibernation; avoid 10s timers                             |
| DO rows written      | 100k/day              | Alarm path drops job-lease writes                                         |
| Subrequests          | 50/request            | Watch x402 receipt polling + multi-org sweeps                             |
| DO storage           | 5 GB / account (Free) | Ample for early usage                                                     |

**Spike (local workerd, 2026-10-23):** scrypt hash+verify avg **52.3 ms** (samples 56 / 50 / 51).
Exceeds plain Worker Free **10 ms**; fits DO **30 s**. Local workerd **does not enforce**
free-plan CPU — confirm on a real free-account deploy before cutover.

Workers Vitest pool deferred: monorepo `zod@3` override breaks `@cloudflare/vitest-plugin`
(zod@4). Use `npm run verify:local` / `npm run spike` in `apps/api-worker` instead.

## Secrets and vars

### Vars (`wrangler.toml` `[vars]`)

- `CHAIN=base-sepolia`
- `ABI_CONSOLE_URL` — Vercel console origin (email links)
- `ABI_CORS_ORIGINS` — same origin (browser uses `/abi-api` proxy; CORS rarely matters)
- `ABI_NOTIFY_EMAIL_FROM` — verified Brevo sender, e.g. `ABI <you@gmail.com>`
- `POLICYVAULT_ALLOW_BOOTSTRAP` — Maurice decides (`1` keeps Demo mode)
- `ABI_RUNTIME=cloudflare-workers` (set by Worker)
- `ABI_NO_LISTEN=1`, `ABI_RUN_JOBS=0` (set by Worker)

### Secrets (`wrangler secret put`)

| Secret                      | Required                  | Notes                                                         |
| --------------------------- | ------------------------- | ------------------------------------------------------------- |
| `BREVO_API_KEY`             | Yes for real signup email | Primary; fetch HTTP API (#63). Free plan: one verified sender |
| `RESEND_API_KEY`            | Optional                  | Fallback fetch API                                            |
| `ABI_KEK`                   | **Yes on Workers**        | No disk `abi-demo-secrets.json`                               |
| `ABI_KEY_PEPPER`            | **Yes on Workers**        | Same                                                          |
| `ABI_SIGNUP_TOKEN`          | Yes                       | Must match Vercel                                             |
| `TELEGRAM_BOT_TOKEN`        | Optional                  | Approvals                                                     |
| `TELEGRAM_CHAT_ID`          | Optional                  |                                                               |
| `TELEGRAM_ALLOWED_USER_IDS` | Optional                  |                                                               |
| `TELEGRAM_WEBHOOK_SECRET`   | Yes if Telegram on        | `setWebhook` secret_token                                     |
| `CHAIN_RPC_URL`             | If keyed                  |                                                               |

**Do not** rely on `SMTP_*` / nodemailer in the Worker. #63 keeps SMTP as a Node-only fallback; the Worker clears SMTP env vars.

Never set `NODE_ENV=development` for production builds. `wrangler deploy` freezes production at build time.

## Deploy and operate

All commands run from `apps/api-worker` with Node 22 and **always** `--config ./wrangler.toml`
(a bare `wrangler deploy` at the repo root uses `wrangler.jsonc` and targets the wrong Worker).

1. **Secrets** (names only; values never in git): `RESEND_API_KEY`, `ABI_KEK`, `ABI_KEY_PEPPER`,
   `ABI_SIGNUP_TOKEN`, and `CHAIN_RPC_URL` only if it embeds a provider key —
   `npx wrangler secret put <NAME> --config ./wrangler.toml`; check with `npx wrangler secret list --config ./wrangler.toml`.
2. **Note the rollback target:** `npx wrangler deployments list --config ./wrangler.toml`.
3. **Deploy:** `npx wrangler deploy --config ./wrangler.toml --var ABI_GIT_COMMIT:$(git rev-parse HEAD)`,
   then check `/health` (its `revision` is the deployed commit) and `npx wrangler tail --config ./wrangler.toml`.
4. **Vercel:** production `ABI_API_ORIGIN` = the Worker URL; `ABI_SIGNUP_TOKEN` identical to the Worker secret;
   leave `NEXT_PUBLIC_API_URL` unset so the browser uses `/abi-api` (first-party cookies). Redeploy web.
5. **Workers Builds:** the `artificialbanking` Worker's Git builds must not deploy this API; deploy abi-api with the command above.

## Local commands

```bash
cd /workspace/apps/api-worker
cp .dev.vars.example .dev.vars   # local only; gitignored
npx wrangler dev
npm run spike                    # vitest pool spike
npm test                         # Workers runtime tests
npm run deploy:dry-run           # size check; does not deploy
```

## Email

Resend HTTP (`RESEND_API_KEY`, sender `ABI_NOTIFY_EMAIL_FROM` in `wrangler.toml`). Brevo
(`BREVO_API_KEY`) takes precedence when set — leave it unset unless switching. SMTP is Node-only (#63)
and is stripped inside the Worker.

## Rollback

1. `npx wrangler rollback <previous-version-id> --config ./wrangler.toml`.
2. Durable Object data is not rolled back; schema migrations are additive.

## Expected overlaps with open PRs

| PR      | Overlap                                                                                                                                                                                                                                                                                                                                |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **#61** | `outbound-url.ts` (replace `dns.lookup` with DoH seam — already here); `telegram.ts` (`resolveTelegramVoter` + polling rewrite — reuse webhook handler); `store.ts` migrations/methods vs lazy Proxy adapter; `secrets.ts` disk `abi-demo-secrets.json` (Workers require explicit secrets); `webhooks.ts` durable retry job → DO alarm |
| **#63** | `platform/email.ts` Brevo HTTP primary; `BREVO_API_KEY`, `ABI_ALLOW_UNVERIFIED_SIGNUP`; auth-routes signup guard                                                                                                                                                                                                                       |
| **#62** | `config.ts` env loader; `index.ts` entry; logger/`process.exit`; may touch boot path the Worker imports                                                                                                                                                                                                                                |

Design goal: additive `apps/api-worker` + small seams so rebase onto #61 is mechanical.
