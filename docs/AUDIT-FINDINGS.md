# ABI Audit Findings Log

Working register of security/audit findings verified against the live codebase.
Updated during the `cursor/abi-platform-polish-1ad2` build pass.

| ID | Finding | Severity | Status | Reasoning / fix |
|----|---------|----------|--------|-----------------|
| A1 | Subscription sweep could double-charge while awaiting rail | high | **fixed** | `claimSubscriptionRun` now claimed before `executeIntent` |
| A2 | Telegram approvals unbound to chat / identity | high | **fixed** | Chat id must match `TELEGRAM_CHAT_ID`; optional `TELEGRAM_ALLOWED_USER_IDS`; quorum id `tg:<userId>` |
| A3 | Unauthenticated `POST /v1/guardian/orgs` | high | **fixed** | Gated like bootstrap; `POLICYVAULT_ALLOW_PUBLIC_ORG_CREATE` |
| A4 | Approver role had owner powers | high | **fixed** | `ownerOnly` on mutate routes; invite cannot create `owner` |
| A5 | x402 followed redirects (SSRF / host swap) | med | **fixed** | `redirect: "error"` on both fetches |
| A6 | Missing settlement `success` booked as settled | med | **fixed** | `settled: settlement.success === true` |
| A7 | Approval stuck in `resolving` on throw | med | **fixed** | `unclaimApproval` on unexpected `executeIntent` throw |
| A8 | Domain allowlist bare TLD (`com`) | med | **fixed** | Suffix match requires dotted entry |
| A9 | Compliance denylist used unanchored `includes` | low | **fixed** | Equality / dotted suffix only |
| A10 | Webhook SSRF denylist incomplete | med | **fixed** | Expanded IPv6/CGNAT/metadata/credentials; re-check + `redirect: "error"` on delivery |
| A11 | Escrow state update not conditional on `locked` | low | **fixed** | `claimEscrow` CAS locked→settling before ledger; `unclaimEscrow` on failure |
| A12 | `escrow_lock` skips compliance screen | low | **fixed** | `screenDestination` before lock; same `COMPLIANCE_BLOCKED` shape as pay |
| A13 | Plaintext API keys in SQLite | med | fixed | `h1:sha256(pepper\|\|secret)` at rest; reveal-once on create/rotate; boot rehashes legacy plaintext |
| A14 | Prisma schema unwired vs SQLite store | med | deferred | Swap behind `store` boundary — see PLATFORM-ARCHITECTURE |
| A15–A29 | Broader NFR/checklist items from FULL-SCALE-BUILD-PLAN | varies | tracked | Extension points landed; no silent false closes |

## How findings are closed

- **fixed** — code change landed and covered by build/tests or E2E
- **open** — valid, deferred with a clear next step
- **deferred** — valid but blocked on intentional architecture choice
- **false positive** — documented with evidence (none in this pass)

Do not mark a finding closed without a commit reference or explicit false-positive note.
