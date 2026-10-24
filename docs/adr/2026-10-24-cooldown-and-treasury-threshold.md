# 2026-10-24 — Counterparty cooldown verdict and treasury approval threshold

## Counterparty cooldown

**Verdict: the design is sound; one bypass was fixed.**

Why it holds:

- Unknown or legacy first-seen data fails safe: the payment goes to review, never to allow.
- `first_seen` is written with `INSERT OR IGNORE`, so re-adding a counterparty cannot reset its clock.
- The cooldown and the clock it is compared against come from the same server time.
- Hard caps (freeze, blocklist, per-payment ceiling, daily max) are evaluated before the cooldown, so the cooldown can only add review, never relax a refusal.
- Concurrent requests can at worst both be sent to review.

What was wrong: the "is this destination known?" check matched either the raw value or the URL hostname,
but the first-seen lookup used only the raw value. A URL whose host had been added moments ago was
treated as known with no first-seen time and skipped the cooldown. `counterpartyFirstSeenForDestination`
now looks up the same keys as the known-check (earliest time wins; any legacy row means review).
Covered by the "counterparty cooldown keys" suite in `apps/api/src/agent-policy.test.ts`.

## Treasury approval threshold

`treasuryHitlUsdc` (default $50) is a **threshold that triggers guardian review**, not a second blocking gate.

- At or below the threshold: treasury moves and guardian USDC withdrawals run immediately.
- Above it: hard limits are checked first (a refusal returns 403 and nothing is parked); otherwise the request
  is parked as a pending treasury move (HTTP 202, `outcome: "review"`) until the approval quorum approves.
  Nothing is refused because of the threshold.
- On approval, withdrawals are claimed atomically and re-checked against the hard limits before sending; if a
  limit now refuses, the move is cancelled.
- The voter identity is always the authenticated guardian; a client-supplied `resolvedBy` no longer counts as
  a vote (this closed a quorum bypass).
- Per-withdrawal and 24h withdrawal caps remain hard limits.

The setting lives in **Settings › Team & quorum**, next to Approval quorum and Guardians, because the review it
triggers is decided by that quorum. Tests: `apps/api/src/treasury-threshold.test.ts`.
