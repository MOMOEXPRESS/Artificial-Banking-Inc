# Connect ChatGPT to an ABI sandbox agent

ABI exposes a remote MCP endpoint for one concrete proof:

> an external ChatGPT conversation authenticates as a revocable ABI agent,
> submits a genuine sandbox payment request, receives the real policy decision,
> and leaves the decision in ABI's ledger and activity history.

This endpoint is intentionally **sandbox-only**. It rejects organizations whose
ledger mode is `live`.

## 1. Create the short-lived ABI connection

1. Sign in to the ABI console.
2. Open **Agents** and select the agent ChatGPT should act as.
3. Open **Sessions**.
4. Select only `read` and `pay`. Do not select `escrow` for this test.
5. Use a label such as `ChatGPT proof`, then mint the 24-hour session.
6. Copy the **ChatGPT developer-mode MCP URL** shown once beneath the token.

The URL contains a short-lived bearer capability. Treat the whole URL as a
secret: do not post it, put it in source control, or send it to another person.

## 2. Add ABI to ChatGPT

With ChatGPT developer mode enabled:

1. Open **Settings → Apps** (the label may appear as **Connectors** in some
   clients).
2. Create a custom app/connector.
3. Name it `ABI Sandbox`.
4. Paste the copied MCP URL.
5. Choose **No authentication**. The short-lived capability is already inside
   the URL for this prototype.
6. Save the app, then enable `ABI Sandbox` for a new conversation.

ABI uses MCP Streamable HTTP. A connection with `read` exposes:

- `abi_get_spending_capacity`
- `abi_simulate_payment`
- `abi_list_activity`
- `abi_get_decision`

A connection with the explicit `pay` scope also exposes:

- `abi_propose_payment`

## 3. Run the proof

Ask ChatGPT:

> Check whether your ABI agent is authorized to purchase a $0.01 research
> report from `data.example`. If the simulation allows it, submit the sandbox
> payment with a unique idempotency key, then show me the recorded ABI activity.

Expected result:

1. ChatGPT calls `abi_get_spending_capacity`.
2. ChatGPT calls `abi_simulate_payment`.
3. ChatGPT asks for confirmation before the write tool if its client requires
   confirmation.
4. ChatGPT calls `abi_propose_payment`.
5. ABI returns `ALLOW`, `REVIEW`, or `DENY` with a human-readable reason.
6. `abi_list_activity` returns the same recorded decision.
7. Refreshing ABI's Activity/Transactions UI shows the external request.

`data.example` is the bundled sandbox research merchant in the default policy.
An organization with a customized policy may use a different approved merchant.

## 4. Revoke the proof connection

Return to **Agents → Sessions** and revoke the `ChatGPT proof` session. The MCP
URL stops working immediately. It also stops working automatically at expiry.

## Security boundary

- Only `pv_sess_` session credentials work; permanent agent and guardian keys
  are rejected.
- The session must include `read`; write tools only appear with explicit `pay`.
- Live-ledger organizations are rejected.
- Every write uses ABI's existing agent API, policy engine, idempotency layer,
  settlement rail, ledger, and audit trail.
- The endpoint never gives ChatGPT a vault private key, guardian key, signup
  token, or permanent agent key.

The credential-in-URL form exists only to support a small developer-mode proof
with a no-auth custom app. Production external connections should replace it
with OAuth authorization, connection management, per-tool grants, and a
guardian-visible consent/revocation screen.
