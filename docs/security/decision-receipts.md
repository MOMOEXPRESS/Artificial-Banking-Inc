# Decision numbers, `supersedes`, and signed receipts

Every policy decision ABI records (agent pay / pay_api / escrow, approval
resolution, subscription charges, guardian treasury withdrawals, x402 client
guard refusals) now carries three things.

## 1. Structured denial numbers (`limits`)

When a refusal is caused by a cap, the API response, the stored decision row
(`decisions.limits_json`) and the `approval.resolved` / `policy.denied` /
`payment.failed` events carry:

```json
{
  "ruleId": "daily_max",
  "unit": "usdc",
  "attempted": "80",
  "cap": "150",
  "used": "80",
  "remaining": "70",
  "window": "24h"
}
```

Amounts are decimal USDC strings (`unit: "count"` for velocity). A frozen org
or agent is reported as an effective cap of `0` with `window: "frozen"`.
Covered rules: `per_tx_max`, `daily_max`, `org_daily_max`,
`merchant_daily_max`, `budget_window_exhausted`, `category_per_tx_max`,
`category_daily_max`, `velocity`, `treasury_withdraw_max`,
`treasury_withdraw_daily_max`, `org_frozen`, and the post-approval re-check.

## 2. `supersedes`

`POST /v1/agent/pay`, `/v1/agent/pay_api` and `/v1/agent/escrow/lock` accept an
optional `supersedes: <intentId>`. It is accepted only if that intent exists in
the same org, was made by the same agent, and its latest decision was `deny`;
otherwise `400 VALIDATION_ERROR` (`field: "supersedes"`). The link is stored on
the new decision and signed into its receipt, so an agent's "smaller retry"
after a refusal is auditable.

## 3. Signed decision receipts

Each decision gets a `receipt`:

```json
{ "body": { "v": 1, "decisionId": "…", "intentId": "…", "orgId": "…", "agentId": "…",
            "outcome": "deny", "tool": "pay", "amountUsdc": "80", "destination": "0x…",
            "ruleIds": ["daily_max"], "reasons": ["…"], "limits": { … },
            "supersedes": null, "policyVersion": "…", "policyHash": "<sha256>",
            "requestHash": "<sha256>", "nonce": "<hex>", "at": "<iso>" },
  "alg": "HMAC-SHA256", "keyId": "<first 16 hex of sha256(key)>", "signature": "<hex>" }
```

- Signature = HMAC-SHA256 over the canonical JSON of `body` (keys sorted at
  every level, no whitespace).
- Key = `HMAC-SHA256(ABI_DECISION_SIGNING_KEY || ABI_KEY_PEPPER, "abi-decision-receipt-v1")`.
  No new secret is required: if `ABI_DECISION_SIGNING_KEY` is unset the key is
  derived from the existing `ABI_KEY_PEPPER`. If neither is set (local dev),
  receipts are still produced with `alg: "none"` and an empty signature —
  decisions never fail because signing is unavailable.
- Verify with `POST /v1/agent/decision-receipts/verify` or
  `POST /v1/guardian/decision-receipts/verify` (`{ "receipt": … }` →
  `{ "valid": true }` or `{ "valid": false, "reason": "unsigned" | "unknown_key" | "bad_signature" | "malformed" }`),
  or in-process with `verifyDecisionReceipt()` from `apps/api/src/decision-receipts.ts`.

HMAC was chosen because it runs identically in Node and Cloudflare Workers with
no extra key material. Follow-up: Ed25519 with a published public key so third
parties can verify without calling ABI.
