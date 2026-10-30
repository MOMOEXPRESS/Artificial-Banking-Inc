# Security overview

ABI applies organization-scoped access, authenticated user sessions, second
factor checks for sensitive approvals, and policy evaluation to agent payment
requests. Budgets define spending authority, while the ledger and activity
records provide an audit trail for decisions and settlements.

## Current posture

- Local vault keys are encrypted at rest (`ABI_KEK`). Managed custody (CDP/MPC)
  is not built — see [FREE-STACK.md](./FREE-STACK.md). Never derive the pepper
  or KEK from `ABI_SIGNUP_TOKEN`.
- The policy engine is separate from the agent, not from custody: agents hold
  only an ABI API or session key, while ABI's API server holds each org's
  encrypted vault key and signs after the policy check. No HSM or MPC sits in
  between yet.
- Agent credentials cannot vote on approvals (`self_approval_forbidden` /
  `agent_cannot_approve`). Approvals expire after `APPROVAL_TTL_MINUTES` as
  "expired, not sent". Policy read failures refuse (`policy_unavailable`).
  Details: [REFUSALS-AND-APPROVALS.md](./REFUSALS-AND-APPROVALS.md).
- Telegram approvals require a per-org chat (or documented single-tenant
  fallback), an allowlist or linked `conditions.telegramUserId`, and the same
  role / max-approve gates as the console. Amounts at/above the step-up
  threshold must be approved in the console (Telegram cannot satisfy MFA).
- x402 persists an authorization marker before the seller receives the signed
  payload; post-sign failures become `needs_review` and keep the hold.
- Outbound URL checks cover IPv4-mapped IPv6 (hex + dotted), reserved ranges,
  and DNS resolution/pinning on real fetches.
- Webhook signatures are timestamped (`t=,v1=`); retries are durable in SQLite.
- Base Sepolia is the intended development network. A successful test-network
  run does not establish production readiness.
- ABI is software infrastructure, not a bank or a compliance certification.
  Operators remain responsible for their own legal and operational review.

## Operating guidance

Keep credentials in the hosting provider's secret manager. Limit production
access to the people who operate the service, maintain recoverable backups, and
review consequential payment activity. Do not commit secret values, customer
data, or private security assessment material to the public repository.

Use the deployment checklist to validate the running services and complete a
controlled end-to-end payment test before describing a settlement path as
verified.
