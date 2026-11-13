# Turnstile activation manifest

The frontend and existing API implementation are prepared. The user has explicitly approved this manifest in the conversation. Activation follows deployment of the compatible code; the secret remains only on the existing Worker.

- Cloudflare account: b1b2748f5faa6a63cc8f6737c03c9139.
- New managed widget: ABI sign-in protection. No existing widgets were found; no widget will be replaced.
- Widget domains: artificial-banking-inc-web.vercel.app, localhost and 127.0.0.1.
- Existing backend: Worker abi-api, deployed by the existing Vercel production pipeline. No new infrastructure.
- Secret destination: TURNSTILE_SECRET on that Worker. Its value stays in Cloudflare and is never printed or written to a temporary file.
- Nonsecret configuration: TURNSTILE_SITEKEY; TURNSTILE_HOSTNAMES=artificial-banking-inc-web.vercel.app. Production never accepts localhost or 127.0.0.1 as a verified hostname.
- Actions: buyer_login and buyer_signup on /v1/auth/login and /v1/auth/signup; seller_login and seller_signup on /v1/partner/auth/login and /v1/partner/auth/signup.
- Siteverify runs in the existing server handlers, requiring success=true, exact expected action and an approved hostname. Tokens reset after every browser submission. Failures remain closed.
- Activation follows deployment of the compatible frontend and API. Verify a real fresh token succeeds once and replay fails. If real-token validation cannot be completed, do not report end-to-end activation as verified.
