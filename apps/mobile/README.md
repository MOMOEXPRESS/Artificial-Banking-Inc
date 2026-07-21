# ABI Mobile Approvals (Expo v0)

Guardian companion for **approve-on-the-go**. Reads the same `/v1/guardian/approvals` API as the web console.

## Quick start

```bash
cd /workspace/apps/mobile
npm install
EXPO_PUBLIC_API_URL=http://localhost:8787 EXPO_PUBLIC_GUARDIAN_KEY=pv_guardian_… npm start
```

## Production path

1. **PWA** — install `/approvals` from the web app (see `apps/web/public/site.webmanifest` shortcuts).
2. **Expo** — wire `expo-secure-store` for the guardian key and push notifications (deferred).

This v0 is read-only + approve/deny with polling every 10s.
