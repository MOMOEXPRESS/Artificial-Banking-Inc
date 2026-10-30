# Refusals, approvals and session budgets

How ABI says "no", how a parked payment is decided, and what an agent may do
next. Every behaviour below is covered by
`apps/api/src/approvals-refusals.api.test.ts`.

## Who decides, and who holds the key

- **The agent** holds only its ABI credential (an agent API key or a session
  key). It can propose payments and read its own budget, decisions and
  approvals. It cannot read or change its policy, and it never sees a vault
  private key.
- **The policy engine** (`packages/policy`, run by the ABI API) decides
  allow / review / deny from structured fields only. It is separate from the
  agent: no agent credential can reach a policy-writing route
  (`policy-isolation.test.ts`), and no agent credential can vote on an
  approval (see below).
- **Custody is not separate from ABI's server yet.** Each organization's vault
  private key is stored encrypted (AES-256-GCM under `ABI_KEK`) in ABI's
  database. ABI's API server decrypts it and signs only after the policy check
  passes. There is no HSM, MPC or managed-custody provider in between today;
  moving signing out of the API process is on the roadmap.

## The refusal shape

Every refusal carries a `denial` object. The older fields (`error.code`,
`ruleIds`, `limits`, `receipt`) are unchanged, so existing clients keep
working; `error.rule_code` mirrors `denial.rule_code` for clients that only
read `error`.

```json
{
  "outcome": "deny",
  "error": { "code": "POLICY_DENIED", "message": "Exceeds daily max", "rule_code": "daily_max" },
  "ruleIds": ["daily_max"],
  "denial": {
    "rule_code": "daily_max",
    "payment_state": "not_sent",
    "charged_usdc": "0",
    "next_step": { "action": "wait_for_window", "message": "…", "window": "24h" },
    "numbers": {
      "ruleId": "daily_max",
      "unit": "usdc",
      "attempted": "60",
      "cap": "150",
      "used": "100",
      "remaining": "50",
      "window": "24h"
    }
  }
}
```

- `rule_code` is stable: the same request refused for the same reason always
  returns the same code (and the same `denial`), whatever idempotency key it
  used. A refusal never charges anything.
- `payment_state` is one of `not_sent`, `awaiting_approval`,
  `expired_not_sent`, `cancelled_not_sent`. In every one of them nothing has
  been signed or broadcast.
- `next_step.action` is the one move the agent may make next:
  `lower_amount`, `wait_for_window`, `ask_guardian`, `check_status`,
  `repropose`, `retry_later`, `request_new_session`, `re_request` or `none`.
- `numbers` is present for cap refusals (the "denial numbers").

## Approvals

- **Nobody approves their own request.** Each approval records who asked
  (`requestedBy`: `agent:<id>` or `session:<id>`). An agent API key or session
  key calling `POST /v1/guardian/approvals/:id/resolve` gets `403` with
  `rule_code: "self_approval_forbidden"` (its own request) or
  `"agent_cannot_approve"` (anyone else's). The engine applies the same rule
  for every caller, no vote is recorded, and the approval stays pending.
- **Approvals expire after a fixed time.** `APPROVAL_TTL_MINUTES` (whole
  minutes, default 10, at most 14 days; an unreadable value falls back to 10).
  An expired approval ends as `expired` with `payment_state:
"expired_not_sent"`: never an automatic yes, nothing held, nothing
  broadcast. Expiry is a compare-and-set on `pending`, so it can never
  overwrite an approval a guardian already claimed, and an approval can never
  execute after it expired. A retry under the same idempotency key replays
  the expired outcome; to try again the agent proposes a new intent with
  `supersedes`.
- Expiry emits `approval.resolved` with `status: "expired"`,
  `resolvedBy: "system:approval_expiry"`, and a named `owner` (the org's
  owner) whose decision it was waiting for.

### Stale approvals are cancelled ("dead, not old")

An approval binds to the rules it was parked under: `policyRevision` (the
org's policy version) and `rulesHash` (`r2:` + sha-256 of the agent's
effective caps, budgets, windows and allowlists — org template plus agent
override — and the session key's x402 budget). Spend counters and balances
are not part of the hash: other payments settling do not make an approval
stale, and the vote-time policy re-check still enforces every cap.

If either changes while the approval is pending, it is **cancelled**:

- **When:** at the moment of the change (every policy write — template edits,
  restores, template applies, quorum changes, allowlist changes from
  connections, agent overrides set or cleared — cancels what it made stale),
  in the scheduled approval sweep (every 10 s), on approval and intent-status
  reads, when a guardian votes, and once more under the claim right before
  execution.
- **End state:** status `cancelled_stale`, `resolvedBy:
"system:stale_cancel"`, and the reasons recorded (`staleReasons`:
  `policy_revision_changed`, `rules_hash_changed`).
- **Money:** nothing is sent. A parked approval holds no funds (nothing is
  reserved until a guardian's yes executes), so there is nothing to release.
- **Event:** `approval.resolved` with `status: "cancelled_stale"`,
  `resolvedBy: "system:stale_cancel"`, `staleReasons`, `ruleIds:
["approval_stale"]` and the `denial` — exactly once.
- **Refusal:** `rule_code: "approval_stale"`, `payment_state:
"cancelled_not_sent"`, `next_step.action: "re_request"`. A guardian vote on a
  stale approval gets `409 APPROVAL_STALE` with the same `denial`; the vote is
  not recorded and nothing executes. A retry under the same idempotency key
  replays the cancellation; the agent re-requests with a **new** key and is
  checked against the current rules.
- **Agent-readable record:** `GET /v1/agent/approvals/:id` shows
  `status: "cancelled_stale"`, `stale` (the reasons) and `cancelled: { reason,
staleReasons, by, at, rule_code, next_step }`; the intent status read
  returns `state: "cancelled_stale"` (terminal).
- **Idempotent:** cancellation is a compare-and-set on `pending` (or on the
  guardian's claim), so each approval is cancelled at most once; repeat
  sweeps and later policy changes do nothing.
- Approvals parked before this change carry an older hash format and are
  judged on `policyRevision` alone.

Note: every policy write bumps the revision, so any edit — even one unrelated
to a given payment, such as allowlisting a new seller — cancels all of the
org's pending approvals. That is the intended "dead, not old" behaviour.

## x402 session budgets

The x402 SDK caps a single payment. ABI adds a total per session key: a
guardian minting a session key can pass `x402BudgetUsdc`
(`POST /v1/guardian/agents/:id/session-keys`). Every `pay_api` call through
that key counts against it — settled payments at what was charged, anything
in flight or uncertain at the full authorized amount — and a payment that
would exceed it is refused with `rule_code: "session_budget"`. The check and
the reservation happen in one database transaction before anything is sent,
so two concurrent payments cannot spend the same headroom. The agent's own
daily, monthly and velocity caps still apply on top.

## Fail closed

If ABI cannot read the policy or evaluate it, the answer is a `503` refusal
with `rule_code: "policy_unavailable"` and `payment_state: "not_sent"` —
never an allow. An unreadable session budget counts as zero. Money arriving
(budget top-ups, escrow releases from other agents) never raises a cap or
reduces counted spend.
