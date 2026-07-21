# ABI Mobile Approvals (Expo)

Guardian companion for **approve-on-the-go**. Same `/v1/guardian/approvals` API as the console.

## Features (v0.1)

- **SecureStore** for the guardian key (device-encrypted)
- Poll every 10s + Approve / Deny
- Prefer the installable **PWA** at `/approvals` for most guardians

## Quick start

```bash
cd apps/mobile
npm install
EXPO_PUBLIC_API_URL=http://localhost:8787 npm start
```

Paste a `pv_guardian_…` key on first launch.

## Push notifications (next)

1. Add `expo-notifications`
2. Register device token on `POST /v1/guardian/devices`
3. Fan out from approval-create webhook / Telegram path

Not wired yet — use Telegram or `/approvals` PWA for push-like alerts today.
