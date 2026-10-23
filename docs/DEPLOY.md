# Deployment overview

ABI runs as two services: the API on a persistent application host and the web
console on a frontend host. The repository includes a Render Blueprint for the
API and can be connected to a Vercel project for the console.

## Deploy the API

1. Connect the repository to Render and create the service from its Blueprint.
2. Complete the private environment setup requested by the host. Keep API
   credentials in the host's secret manager; do not add them to repository
   files or client-side variables.
3. Confirm the service is healthy in the Render dashboard and that its
   persistent storage is attached.

## Deploy the console

1. Connect the repository to Vercel and deploy the console project.
2. Set the private API origin and the shared registration setting in the
   Vercel project environment, matching the values configured for the API.
3. Redeploy the console after changing project environment settings.

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

### Brevo free setup (owner sets these on Render)

1. Create a free Brevo account and verify **one sender email** (Senders — no domain required).
2. Create an API key (SMTP & API → API keys).
3. On Render set:
   - `BREVO_API_KEY=<api-key>`
   - `ABI_NOTIFY_EMAIL_FROM=ABI <your-verified-sender@example.com>`
   - `ABI_CONSOLE_URL=https://artificial-banking-inc-web.vercel.app` (or your console URL)

## Verify the release

- Open the console and confirm account creation and email verification work.
- Confirm the API and console both report healthy in their hosting dashboards.
- Exercise a small sandbox payment and confirm ABI records the policy decision.
- Treat test-network results as development checks; complete a reviewed,
  funded end-to-end test before describing live settlement as verified.

## Production readiness

Before inviting external users, confirm persistent backups, account recovery,
email delivery, monitoring, incident ownership, and payment review procedures.
Configure all production-only values in the relevant hosting dashboards, and
verify them there without copying their values into source control.

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
