# Reliability, signed maximums and outflow reconciliation

Items 2–5 of the Oct 30 list (Tina and Broddy). Item 1 (refusals, approvals,
session budgets) is in [REFUSALS-AND-APPROVALS.md](./REFUSALS-AND-APPROVALS.md).
Tests: `apps/api/src/reliability-oct30.api.test.ts`.

## 1. Uncertain payments are rechecked, never guessed

When ABI cannot tell whether money moved (the seller returned an error after
the authorization was signed, a withdrawal broadcast had no receipt yet, the
process stopped mid-send), the payment is **`outcome_unknown`**. It is never
marked failed without evidence and it is never retried by a background job.

Every settlement row records:

| Field                             | Meaning                                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `resolver`                        | Named way the answer is read: `x402:authorization_state` (EIP-3009 nonce) or `chain:tx_receipt`        |
| `escalateTo`                      | Named owner who gets it at the second deadline (`owner:<name>`)                                        |
| `recheckAfter`                    | First deadline: the next time the job reads it (`ABI_RECHECK_MINUTES`, default 2)                      |
| `escalateAt`                      | Second deadline: if still unknown, handed to `escalateTo` (`ABI_UNKNOWN_ESCALATE_MINUTES`, default 60) |
| `signedMaxMicro`                  | The most the signature can move (see §3)                                                               |
| `policyRevision`                  | Policy revision it was checked against                                                                 |
| `idempotencyKey` / `...ExpiresAt` | The caller's key and how long a retry with it still replays                                            |

The recheck job (`recheckUncertainPayments`, run every tick with
settlement recovery, including the Worker alarm) turns evidence into an end
state:

| End state           | When                                                                                                        | Money                                    |
| ------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `settled`           | Booked by the request path                                                                                  | Spent                                    |
| `failed`            | The transaction reverted, or the send was never signed                                                      | Hold released                            |
| `expired_unclaimed` | The authorization nonce is unused on-chain **and** `validBefore` + 60 s has passed: it can never be claimed | Hold released                            |
| `claimed_unbooked`  | The nonce was used / the transfer succeeded, but ABI has not booked it                                      | Stays held; escalated to a human to book |
| `unresolved_closed` | A guardian closed it by hand (`POST /v1/guardian/settlements/:id/close`): "unresolved, closed by X at T"    | Stays held and counted; still rechecked  |
| `not_assessed`      | (intent state) the policy could not be read, so the payment was never evaluated                             | Nothing moved                            |

Anything the reader cannot decide stays `outcome_unknown`, is rescheduled to
the first deadline, and is escalated once at the second. The escalation
deadline is always less than half the idempotency key's lifetime, so the owner
is told while a retry still replays instead of paying twice. A stop and
restart (process killed between the two deadlines) picks up the same plan from
the database.

**Unknown on mismatch.** An idempotency key reused with a different request
body returns `409 IDEMPOTENCY_MISMATCH` with `outcome: "unknown"` — ABI never
answers "failed" for a request it may already have executed.

### Status reads

- `GET /v1/agent/intents/:intentId/status` (agent key, `read` scope)
- `GET /v1/guardian/settlements/:intentId` (guardian; any intent or withdrawal)

Both return `state`, `settlement` (outcome, resolver, held amount, deadlines,
where released money went) and `recheck_after` while the answer can still
change. 409 responses for uncertain sends carry `state`, `recheck_after` and
`status_url`.

### Approval record the agent can read

`GET /v1/agent/approvals/:id` now returns `rulesHash` (sha-256 of the
canonical policy rules at request time), `policyRevision`, the current
revision, `stale` reasons, and `approver` (`null` while pending, then who
resolved it, when, and each guardian vote). A stale approval is **reported**,
not auto-cancelled: execution re-evaluates against the current rules anyway.
This deviates from Tina's "dead, not old" wording — flagged for a decision.

## 2. Withdrawals are safe to retry

`POST /v1/guardian/treasury/withdraw` (and the console) accept an idempotency key in
the body (`idempotencyKey`) or the `Idempotency-Key` header (8–128 chars).

- Same key, same body → the stored result is replayed; nothing is sent twice.
- Same key while the first is still running → `409 IDEMPOTENCY_IN_FLIGHT`.
- Same key, different body → `409 IDEMPOTENCY_MISMATCH`, outcome unknown.
- A clean refusal (validation, insufficient funds) releases the key so the
  caller can fix and retry; anything uncertain keeps it.
- Keys expire after `ABI_IDEMPOTENCY_TTL_HOURS` (default 168 h, clamped 1 h–90 d).
  The expiry is a retention guarantee; rows are not deleted by this change.

The console reuses the key when the same amount, destination and asset are
resent after an uncertain answer.

**Guarding human and treasury withdrawals.** The treasury guard's in-flight
total now lives in the database (a reserved `pending` settlement row), so
two API processes or Worker isolates share it. New rule
`treasury_withdraw_reserved`: available balance minus every open withdrawal
(pending, broadcast, or unknown) must cover the new amount. An unconfirmed
withdrawal therefore keeps blocking spend of the same money until it resolves.

**Locks work across processes.** `withVaultLock` still serializes in-process,
and now also takes a database lease (`job_locks`, name `lock:<vault>`, 10-min
TTL renewed every ~3 min). Another process waits up to `ABI_VAULT_LOCK_WAIT_MS`
(default 90 s) and then fails with `LOCK_TIMEOUT` instead of racing the nonce.

## 3. Reserve the signed maximum

Holds and budgets count what the signature **can** move, not what the seller
says it will charge:

- x402: the EIP-3009 `value`, nonce, `validBefore`, payer, payTo, asset and
  network are recorded when signed. If the seller's price exceeds what was
  authorized, ABI refuses before sending (`PRICE_EXCEEDS_AUTHORIZED`).
- Direct transfers: the signed amount is recorded before broadcast.
- Session spend and merchant reservations use `COALESCE(signed_max, amount)`.
- On an uncertain outcome the hold shrinks to exactly the signed maximum; any
  excess is released with reason `above_signed_max`, and the release is
  recorded.

## 4. Outflow reconciliation

`GET /v1/guardian/reconciliation/outflows?onchain=1&limit=100` lists every
send that left — or may have left — the vault with:

- `transferId`: the tx hash, or `eip3009:<nonce>` for x402
- `policyRevision`, `checkedAt` and staleness fields (`staleIf` conditions and
  `stale` reasons: `policy_revision_changed`, `authorization_expired`,
  `amount_changed`)
- `released`: amount, where it went (`releasedTo` account), reason, and
  whether it was cancelled after it may already have taken effect

Direct transfers (agent pay, withdrawals) are signed by the vault and move its
nonce, so they reconcile against the vault nonce (a gap is reported). x402
payments are EIP-3009 authorizations submitted by the seller or facilitator —
batch settlement redeems many at once — so they **do not move the vault
nonce**. They reconcile against USDC `Transfer` logs out of the vault and
`authorizationState(vault, nonce)` (the seller's voucher claim). Limitation:
Transfer logs are read per known receipt, not by a full block-range scan.

## 5. x402 SDK 2.28

`@x402/core`, `@x402/evm` (and `@x402/express` in the Node seller) are pinned
to `~2.28.0` in `apps/api`, `apps/x402-seller` and `apps/x402-seller-worker`.

## Not done / design notes

- The per-period statement was cut from this list.
- **Sub-agent limits (design note only):** a sub-agent's budget must be carved
  out of its parent's remaining budget and policy revision, never added on top;
  a sub-agent can never approve its parent's or its own spend. Not built.
- Residual risk: a process that dies after signing a direct transfer but
  before it records the hash leaves a `pending` row with no hash; the stuck
  sweep marks it failed (nothing broadcast is assumed). The vault-nonce gap in
  reconciliation is the backstop that would surface it.
