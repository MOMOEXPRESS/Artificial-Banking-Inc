# Wallet and transaction flow: source of truth, gas, and testnet procedure

Status: local tests only. Nothing in this branch was deployed, and no live
testnet transaction was executed. No transaction hash in this document or in
the tests is real.

## Source of truth

`GET /v1/guardian/wallet` (apps/api/src/chain/wallet-profile.ts) is the single
answer to "where do I send money, on which network, and what can I send":

- One EVM vault address per org. USDC, EURC and native ETH on the active network
  share it. BTC/SOL have no adapter, so they get no address.
- `address` is returned only when the stored vault key derives to it
  (`addressVerified`). Otherwise the console shows "No verified receiving
  address - do not send funds" and offers nothing to copy.
- `network`: id, name and chain id. On testnet this is Base Sepolia (84532).
  Ethereum Sepolia (11155111) is listed under `funding.wrongNetworks`.
- `gas`: the native ETH balance is reported separately from USDC.
  `sufficient: null` means the RPC could not be read, and the API does not
  guess. No paymaster or sponsorship is configured: custody is a
  self-custodied EOA, so `custody.gasSponsorship` is `false`.
- `balancesSimulated`: sandbox ledger balances are bookkeeping only.
- `assets[].send.mode`: `onchain` is USDC on live orgs. `simulated` covers
  sandbox orgs. `recorded` covers assets with no chain adapter.
  `unsupported` covers EURC and ETH on live orgs: they are read from the
  chain, but no send rail exists, so the API refuses them with
  `409 ASSET_SEND_UNSUPPORTED` instead of editing a number.

## Payment path changes

- Gas preflight: the API estimates gas x maxFeePerGas x 1.2 and refuses
  before broadcast if the vault cannot cover it. Previously only a zero balance
  was caught. The error names the exact network and chain id.
- Broadcast without a receipt (timeout): `SETTLEMENT_UNCONFIRMED`. The agent
  pay route returns `409 SETTLEMENT_UNCERTAIN` and `outcome:
pending_reconciliation` with the tx hash. The hold stays and the ledger
  is not booked. An idempotent retry replays the response and never
  re-broadcasts. The settlement-recovery job reconciles against the chain.
- Treasury withdraw: an uncertain broadcast is recorded in
  `settlement_attempts` (`needs_review`) and the books are left untouched.
  Withdrawals are serialised per org, so two concurrent requests cannot both
  pass the balance check and broadcast.
- Cached balance reads are cleared after a broadcast and after confirmation.
- Pasted agent and session keys: `POST /v1/guardian/agent-keys/verify`
  checks a key against the authenticated guardian's org. It rejects a
  different org (`KEY_ORG_MISMATCH`, which reveals nothing about that org),
  unknown, expired or revoked keys (`KEY_INVALID`), archived agents and
  malformed input.

## Running the tests (local, no network)

```bash
export PATH=/path/to/node>=22.13/bin:$PATH
npm ci
npm run build -w @policyvault/common -w @policyvault/policy -w @policyvault/ledger -w @policyvault/custody
cd apps/api && env -u RESEND_API_KEY -u BREVO_API_KEY node --import tsx --test src/wallet-transaction-flow.test.ts
cd ../web && node --import tsx --test src/lib/wallet-profile.test.ts
```

The chain in `wallet-transaction-flow.test.ts` is a local fake, and
`CHAIN_RPC_URL` points at a closed port.

## Two-account Base Sepolia procedure (manual, not yet run)

Needs: two ABI accounts (A = buyer, B = payee) on a dev or preview API with
`CHAIN=base-sepolia`, plus Base Sepolia test ETH and test USDC from public
faucets (Circle's faucet for USDC, a Base Sepolia ETH faucet). No mainnet. No
real money.

1. Sign up as A and as B. In each account, open Treasury > Vault and record
   the receiving address and chain id shown under the card. Cross-check with
   `GET /v1/guardian/wallet`: `addressVerified: true`, `network.chainId: 84532`.
2. Switch A to live ledger mode, so that only on-chain funds count.
3. Fund A's vault with about 0.005 Base Sepolia ETH and 1 test USDC. Do not use
   Ethereum Sepolia. Wait for confirmations. Then:
   - `/v1/guardian/wallet` should show `gas.sufficient: true` and
     `usdc.onchainUsdc: "1.00"`.
   - Treasury > Sync deposits should credit 1 USDC to the ledger.
4. Negative check: with USDC but no ETH, an agent pay should return
   `INSUFFICIENT_GAS` naming Base Sepolia ETH (chain 84532), and nothing should
   be broadcast.
5. In A, create an agent and a budget. Fund the budget with 0.50 USDC. Add B's
   vault address to the address allowlist. Set the cooldown to 0 for the test.
6. Paste B's agent key into A's playground. It must be refused
   (`KEY_ORG_MISMATCH`). Paste A's own key. It must be accepted.
7. As A's agent, call `POST /v1/agent/pay {amountUsdc: "0.10", destination:
<B vault>, idempotencyKey: "two-acct-1"}`. Record the returned `txHash` and
   open it on sepolia.basescan.org.
8. Reconcile:
   - A's ledger should be down by 0.10 and A's on-chain USDC down by 0.10.
     A's ETH should be down by the gas used.
   - B's on-chain USDC should be up by 0.10. After B's deposit sync, B's
     ledger should be up by 0.10.
   - The receipt should show the same intentId and txHash.
9. Repeat step 7 with the same idempotency key. It must replay the response
   without a second transfer: check the explorer for a single tx.

## Follow-up fixes (review of PR #94)

- **Sandbox agent payments are real testnet transfers (kept on purpose).** An agent
  payment to a `0x` address uses the EVM USDC rail in every ledger mode, so on
  Base Sepolia it broadcasts real testnet USDC from the vault. The wallet profile
  now exposes `agentPayments` (`mode: "onchain"`, `realFunds: true`) and every
  label says so. Only "Add simulated balance" top-ups and guardian Treasury sends
  from a sandbox org remain book-only, and they stay labelled simulated.
- **Ledger mode switch.** `POST /v1/auth/orgs/:orgId/ledger-mode` (`{ mode }`),
  owner-only session route, with a toggle under Settings → Organization profile.
  Mainnet orgs cannot switch to sandbox; switching to live is refused while
  simulated (unbacked) balance is still on the books.
- **Live withdrawals close their settlement row** (`settled` + tx hash), so the
  10-minute recovery sweep no longer flags a successful withdrawal.
- **Playground pasted agent keys** are checked with
  `POST /v1/guardian/agent-keys/verify` before they are stored.
- **Playground custom "On-chain wallet pay"**: can pay any allowlisted wallet or
  another ABI account's vault; a transfer to the org's own vault is refused before
  broadcast; an uncertain (timed-out) settlement is shown as held with its tx
  hash instead of "failed"; sandbox runs with real spend confirm first that real
  testnet USDC will move.
