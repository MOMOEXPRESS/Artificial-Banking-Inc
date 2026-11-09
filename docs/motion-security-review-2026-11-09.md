# Motion and security review — 9 November 2026

## Motion

Use motion for continuity and feedback within the existing white/blue console. Menus scale from their actual Radix trigger origins over 200 ms; exit over 160 ms. Dialogs and the Assistant panel enter without bounce; panel exit returns toward the launcher. Individual translate/scale properties preserve existing layout transforms. Buttons respond at 0.97 scale immediately while held. Toggle knobs stretch by 12% while pressed and settle with ease-in-out. Success toast icons pulse once. Starter rows stagger by 30 ms. Defaults remain visible; reduced-motion users retain all content and state without spatial effects.

The screenshot's arc movement, rubber-band bounds, shared layout IDs, overlapping navigation scenes and color masks are techniques for particular interactions, not effects to apply to every control. ABI currently has no drag/reorder scene that requires them; introducing artificial motion or a new animation framework would reduce usability. No financial state waits for an animation to become operable.

## Security implemented or verified

- Existing server session and membership authorization, owner/approver/viewer rules and CSRF remain the gate for chat, model settings and approval actions.
- Passwords use salted scrypt. Session cookies are HttpOnly, SameSite=Lax, Secure in production; bearer material is excluded from persistent session storage. Sensitive custody/provider secrets use existing encryption.
- Login already has per-IP and per-account throttles. Added a separate chat rate limit to constrain model spend.
- Database queries use the existing prepared SQLite statements and organization-scoped access. This database has no public browser key or PostgreSQL RLS feature; authorization must remain server-side.
- Attachment upload restrictions and untrusted-reference handling are described in `assistant-chat.md`. React renders chat and document names as escaped text; no HTML execution/Markdown injection sink was added.
- Chat capability responses contain no model credentials. Image bytes are never stored in chat history. API request size remains globally bounded to 1 MB.
- Production CSP no longer permits `unsafe-eval`; object embedding is prohibited. Production adds HSTS and insecure-request upgrade. Existing nosniff, frame denial, referrer and permissions headers remain. Inline scripts are still permitted because Next's current rendering uses them; a nonce-based CSP is a separate integration task.
- Added a location-only credential-pattern scanner and CI check. A read-only scan of tracked files and all 361 locally reachable revisions found only the three deliberately public X401 test issuer keys. Their exact fingerprints are allowlisted; no directory is exempted. No live credential was identified by this targeted scan, and no Git history was rewritten. This does not establish an exhaustive secret audit.
- Ran npm production dependency audit and applied compatible fixes without `--force`, including Next.js 15.5.29 and MCP SDK updates. Both critical findings in the initial audit were cleared. Residual findings are recorded below; a clean security certification is not claimed.

## Remaining work

Cloudflare Turnstile is not enabled by this release. A real widget, deployment hostname/action checks, server Siteverify and single-use-token verification must be configured and tested together before calling bot protection complete. The Turnstile setup skill requires a confirmed widget/destination manifest before secret retrieval or writes. No widget or secret has been changed implicitly.

The post-update production audit still reports 13 findings (0 critical, 10 high, 3 moderate), including Zod's major-version upgrade, Next/transitive dependencies, x402 and Prisma dependencies. These require targeted upgrades and compatibility validation; forcing major upgrades into the chat release would be unsafe. Preserve the npm audit JSON from the verification session for advisory details. The runtime uses SQLite, not Prisma's generated client, but unused dependency presence is not treated as a clean audit result.

Transport HTTPS enforcement relies on Vercel/Cloudflare in production; local HTTP development remains usable. No live penetration test, custody recovery, financial transfer or real-model purchase has been performed as part of this release.
