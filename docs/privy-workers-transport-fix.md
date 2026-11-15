# Privy transport repair — 15 November 2026

Cloudflare Workers rejects `fetch` with `redirect: "error"` before sending a request. Both Privy transports used that option, producing the generic “Privy could not be reached” response without contacting Privy.

The shared transport now uses `redirect: "manual"`, restricts requests to `https://api.privy.io`, and rejects all redirect responses. Provider credentials cannot be forwarded by an automatic redirect. Existing timeouts, wallet ownership checks and idempotency remain unchanged.

Validation: API TypeScript check; 13 focused transport, trial and customer-wallet tests; local workerd verification including construction of a real Workers Request with the shared transport (`redirect: manual`, HTTP 200). The spike probe is available only under the existing explicit local spike flag. This verifies runtime compatibility, not successful authenticated provider wallet creation, funding or mainnet activation.

Source: https://developers.cloudflare.com/workers/runtime-apis/request/
