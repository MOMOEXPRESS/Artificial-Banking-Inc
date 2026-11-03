#!/usr/bin/env bash
# Configure Cloudflare Worker abi-api for Brevo signup email, then redeploy.
#
# Requires:
#   CLOUDFLARE_API_TOKEN  — Workers Scripts:Edit + Account:Read (or broader)
#   BREVO_API_KEY         — Brevo SMTP & API → API keys
# Optional:
#   ABI_NOTIFY_EMAIL_FROM — default ABI <momomaurice20006@gmail.com>
#
# Usage (from repo root):
#   export CLOUDFLARE_API_TOKEN=...
#   export BREVO_API_KEY=...
#   ./scripts/configure-brevo-email.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CFG="$ROOT/apps/api-worker/wrangler.toml"
FROM="${ABI_NOTIFY_EMAIL_FROM:-ABI <momomaurice20006@gmail.com>}"
HEALTH_URL="${ABI_PUBLIC_API_URL:-https://abi-api.momomaurice20006.workers.dev}/health"

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "CLOUDFLARE_API_TOKEN is required" >&2
  exit 1
fi
if [[ -z "${BREVO_API_KEY:-}" ]]; then
  echo "BREVO_API_KEY is required" >&2
  exit 1
fi

cd "$ROOT/apps/api-worker"

echo "==> Setting BREVO_API_KEY secret"
printf '%s' "$BREVO_API_KEY" | npx wrangler secret put BREVO_API_KEY --config ./wrangler.toml

echo "==> Ensuring ABI_NOTIFY_EMAIL_FROM=$FROM in wrangler.toml [vars]"
# Keep TOML in sync when overridden via env for this run's deploy --var.
if ! grep -q "ABI_NOTIFY_EMAIL_FROM = \"$FROM\"" "$CFG"; then
  echo "Note: wrangler.toml FROM differs; deploying with --var override for this release."
fi

COMMIT="$(git -C "$ROOT" rev-parse HEAD)"
echo "==> Deploying abi-api @ $COMMIT"
npx wrangler deploy --config ./wrangler.toml \
  --var "ABI_GIT_COMMIT:$COMMIT" \
  --var "ABI_NOTIFY_EMAIL_FROM:$FROM"

echo "==> Checking $HEALTH_URL"
sleep 2
BODY="$(curl -fsS "$HEALTH_URL")"
echo "$BODY" | python3 -c '
import json,sys
h=json.load(sys.stdin)
email=h.get("email") or {}
print("email:", json.dumps(email, indent=2))
ok = email.get("configured") is True and email.get("provider")=="brevo" and email.get("sharedTestSender") is False and email.get("consoleUrlConfigured") is True
sys.exit(0 if ok else 2)
' || {
  echo "Health check failed Brevo readiness. Body:" >&2
  echo "$BODY" >&2
  exit 2
}

echo "OK — Brevo email ready (sharedTestSender=false, provider=brevo)."
echo "Next: open the console → verification screen → Resend verification for the new account."
