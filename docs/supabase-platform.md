# Supabase platform integration

Target: existing project Artificial-Banking-Inc (`ijrjcpegrghlgcnouvbc`, us-east-1), Postgres 17.11.0.018. Initial inspection on 14 November 2026 found no app tables, Auth users, storage buckets or Edge Functions; Google/GitHub providers were disabled. Production ABI already uses durable SQLite for its financial ledger; it is not a mock database.

Implementation order:

1. Complete the explicitly approved Next 16.4.6/Zod 4.6.7/x402 2.31.0 security compatibility migration; remove unused Prisma tooling from the active runtime graph while keeping its optional files.
2. Establish Postgres profiles/file metadata, private Storage, strict session-aware RLS and Realtime file updates. Revoke the detected public execution privileges on the existing rls_auto_enable event-trigger function.
3. Wire Supabase Auth through server-owned PKCE/cookies and validated API identity exchange. Google/GitHub activation requires provider-owned OAuth credentials entered in Supabase's secure dashboard. The connected MCP does not expose provider configuration. Do not display an enabled provider button until Supabase reports it enabled.
4. Preserve existing users, memberships and treasury records. Verified Supabase subject IDs map to ABI users through an explicit identity record. A matching email alone cannot link an existing ABI account; an authenticated existing session and explicit link action are required. Existing MFA and high-value approval controls remain enforced. New SSO accounts start with empty workspaces/cards.
5. Add authenticated file operations and a real Edge Function using the caller's JWT/RLS, plus private Realtime updates. Never put a service-role/secret key into browser code. Model egress remains separately consented.
6. Audit and extend actual deployed MCP tools against the existing API: wallet discovery/context, catalog lookup, quotes, purchase preparation and result inspection. Do not call unavailable provider integration or testnet settlement a completed live mainnet purchase.
7. Activate the separately approved Turnstile recovery on the existing Worker, then verify fresh-token/replay behavior through the real backend. No secret is printed or stored in a temp file.

Financial Postgres cutover must be a separate reconciled migration, not an uncoordinated dual-write. The current API relies on synchronous SQLite transactions across ledger, reservations, approvals and orders; replacing its connection string cannot port those semantics. Before switching authority, supply an async Postgres store, serializable/idempotent transaction tests, a consistent export/checkpoint, exact bigint balance and journal reconciliation, scoped key/identity preservation, rollback, and a bounded write pause. Retain the old authoritative ledger until those gates pass. Do not copy custody secrets or password hashes into browser-exposed tables.

Verification must distinguish SQL/RLS and synthetic API tests, live service reachability, user-completed social sign-in, and actual business operations. Provisioning tables or showing logos is not an end-to-end provider test.

## Verification and operational boundaries — 14 November 2026

Both Google and GitHub now report enabled in Supabase. The PKCE callback uses server-owned HttpOnly cookies. ABI binds its session to the verified Supabase subject and device-session ID, rechecks that provider session on human API requests, and preserves transient failures as retryable 503 responses. Email collisions require explicit linking with proof of the old ABI session and its MFA; external-only accounts cannot use password reset to obtain a local password. Existing funded accounts remain intact.

Hosted migrations establish owner-only profiles and file metadata, a private bucket and private per-user file-change broadcasts. The Edge Function verifies Auth plus the live auth.sessions row before reading through caller RLS. Application file uploads are capped at 3 MB with a content/type allowlist, UUID object paths and forced attachment downloads. Realtime receives an in-memory short-lived access token, never a refresh/service-role key. Files belong to the human identity and are not automatically exposed to agents or models.

Hosted security adviser: no findings. Performance adviser: one informational unused-index notice on the newly created owner/date index, retained for the intended list query. Negative anonymous access and deployed schema/function metadata were checked. An attempted rollback-only positive RLS test was rejected by automatic approval review because production identity inserts can trigger external side effects; it did not run and created no production users. A real signed-in user still needs to complete provider consent and verify upload/download/delete and private realtime end to end. Synthetic API tests prove local identity binding, account-link protection, MFA/replay and zero-funded onboarding; they do not certify provider consent or live RLS.

Real remote MCP tools now include abi_list_wallets and abi_connection_context. Tests use actual MCP transport against isolated SQLite with explicit wallet grants; excluded wallets remain denied. Existing marketplace, quote, order and policy-controlled testnet tools remain. This is not a claim of live mainnet purchasing or a completed Postgres financial cutover.

Turnstile has been removed from buyer/seller password login/signup at the user’s request. Ordinary password and verified-provider sign-in also no longer ask for an ABI authenticator or recovery code. Existing session, identity-linking and sensitive-action controls remain; see docs/sign-in-policy.md and docs/turnstile-hosts.md.
