# Free / open-source stack choices

ABI is maintained with **zero paid-tier spend**. Where a review recommendation
normally implies a commercial product, this document records the free
substitute we ship and what remains deferred.

| Need                      | Paid default                        | Free substitute in this repo                                                                                          | Deferred                                                         |
| ------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Managed custody (TEE/HSM) | Coinbase CDP / Turnkey / Fireblocks | Encrypted self-custody hot keys (`ABI_KEK` + AES-GCM); optional disk-backed demo secrets under the DB path            | Real CDP when budget exists                                      |
| KMS for KEK               | Cloud KMS                           | Explicit `ABI_KEK` env, or random file under `/data` when bootstrap is on — **never** derived from `ABI_SIGNUP_TOKEN` | Envelope re-wrap via cloud KMS                                   |
| Postgres + always-on      | Managed Postgres + paid host        | SQLite on a persistent disk (`render.yaml` / local volume) + `npm run db:backup`                                      | Postgres via `packages/db` when a free-forever host is available |
| Redis / queue             | Redis                               | SQLite `webhook_deliveries` + `webhook-retries` job                                                                   | Redis only if multi-instance                                     |
| Compliance / KYT          | Chainalysis / TRM / Circle          | `ABI_COMPLIANCE_DENYLIST` + optional self-hosted webhook; fail-closed in production                                   | Paid KYT before mainnet                                          |
| Email / SMS               | Resend / Twilio                     | Log/notifier stubs when unset; Slack Incoming Webhooks (free)                                                         | Resend free tier if owner adds a key later (optional)            |
| Monitoring                | Datadog / paid APM                  | In-process `recordObs` → stdout (`platform/observability.ts`)                                                         | OTLP exporter to a self-hosted collector                         |
| Telegram approvals        | —                                   | Bot API (free); per-org `settings.telegramChatId` + guardian `telegramUserId`                                         | Webhook transport (Phase 4 of TELEGRAM plan)                     |
| Card rails / AP2 / L402   | Stripe SPT, Google AP2, Lightning   | Interface stubs under `apps/api/src/platform/rails-future.ts`                                                         | Implement when a free test path exists                           |
| Python SDK                | —                                   | OpenAPI at `/v1/openapi.json` — generate clients later                                                                | Publish when needed                                              |
| Hosting cold-start        | Paid always-on                      | Console proxy returns `API_WAKING_UP` JSON; Fly/Oracle + docker compose                                               | Keep-alive cron (UptimeRobot free)                               |
| Structured logging / APM  | Datadog                             | `pino` JSON to stdout + `GET /metrics`                                                                                | OTLP later                                                       |
| Security headers / WAF    | Paid WAF                            | `helmet` (API) + Next/Vercel headers                                                                                  | Cloudflare free optional                                         |

## Owner setup (all free)

1. Generate secrets (no card):
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```
   Set `ABI_KEY_PEPPER` and `ABI_KEK` (different values).
2. Optional Telegram: set `TELEGRAM_BOT_TOKEN`, per-org `settings.telegramChatId`, and either `TELEGRAM_ALLOWED_USER_IDS` or `conditions.telegramUserId` on a guardian seat.
3. Optional compliance denylist: `ABI_COMPLIANCE_DENYLIST=evil.example,0xbad...`
4. Keep the API process on a free disk-backed host, or accept that free sleeper instances lose in-memory state (SQLite on disk survives if the disk does).
