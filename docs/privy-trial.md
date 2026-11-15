# Privy workspace-wallet trial

15 November 2026. The selected provider is Privy. This is an explicit, owner-only, application-controlled test-wallet trial on Base Sepolia. It provisions a dedicated address per selected workspace and cryptographically verifies a non-payment EIP-712 signature. It does not migrate existing funds, replace the financial custody signer, claim customer self-custody, or enable x402 spending from these trial addresses.

## Configure and use

The existing `abi-api` Worker holds `PRIVY_APP_SECRET` as a secret binding. The public App ID supplied by the user is recorded in `apps/api-worker/wrangler.toml`; the notification destination and existing deployment variables remain synchronized. `ABI_GIT_COMMIT` is injected from the actual release commit by the deployment command, rather than pinned to the previous revision. Both Privy bindings are forwarded server-side into the API runtime. The app secret never enters frontend code, repository files or API responses.

In ABI, select a workspace on Overview, open its Wallet and use **Privy test wallet → Create test wallet → Verify signing connection**. The panel states the trial ownership model and keeps its address separate from the existing receiving route and balances. Use test tokens only. Successful verification records the time and explicitly says no payment was made. A failed or unavailable provider remains an error with a retry action; it is never silently replaced by a local signer.

Routes, all owner-authenticated and workspace-authorized:

- GET `/v1/guardian/workspaces/:workspaceId/privy`: configuration and local trial status. Returns no credentials.
- POST the same path with `{ "acknowledgeTestOnly": true }`: provision or recover the one trial wallet for this workspace.
- POST the same path plus `/verify` with `{}`: verify the existing wallet's non-payment signing connection. No caller-selected RPC, typed data, wallet ID, chain, URL or payee is accepted. Verification never implicitly creates a wallet.

Cookie mutations use ABI's existing CSRF protection. API-key agents, viewers, approvers and foreign workspaces cannot run these owner operations. The trial rejects a mainnet deployment selection. An Ethereum address can exist on other EVM networks, so this restriction is an ABI application boundary, not a claim that the address cannot receive assets elsewhere.

## Provider contract and failure handling

The adapter uses Privy's official REST API at a fixed origin with Basic app authentication, short request deadlines, no credential-bearing redirects and a 64 KB streamed response bound. Creation uses a persisted request key and a stable, non-PII external ID derived from app/organization/workspace IDs. Privy documents unique external IDs per app and lookup with `ext_wal_`, protecting against duplicate wallets even after its 24-hour idempotency window. A lost creation response is recovered by lookup. Explicit provider 5xx responses allow a fresh request key on retry, with the same unique external ID; ambiguous transport failures retain the original key. Changed app credentials or changed/archived provider wallets cannot silently replace existing bindings.

The signing proof uses `ABIConnectionProof`, a random challenge, a two-minute expiry, the workspace ID and wallet address, with an ABI connection domain on chain 84532. It has no payment amount, payee, token contract or USDC authorization type. ABI verifies the returned signature against the stored address before recording success. Provider response bodies and signatures are not returned to the browser or logged.

Sources verified on 15 November 2026:

- [Privy REST quickstart](https://docs.privy.io/basics/rest-api/quickstart)
- [Wallet creation](https://docs.privy.io/api-reference/wallets/create)
- [External IDs](https://docs.privy.io/wallets/wallets/external-ids)
- [Idempotency and error replay](https://docs.privy.io/api-reference/idempotency-keys)
- Official `@privy-io/node` 0.39.0 source, especially its viem adapter and wallet RPC schemas, confirms `eth_signTypedData_v4`, `params.typed_data`, `primary_type` and the EIP-712 camelCase `domain.chainId`. No new SDK dependency was installed for this trial.

## What follows the trial

Privy documents [Supabase JWT authentication](https://docs.privy.io/recipes/authentication/using-supabase-for-custom-auth), allowing the existing login to continue. Before creating customer-controlled wallets, verify the project's asymmetric JWT/JWKS setup and configure Privy's issuer/audience validation. Map the verified immutable Supabase subject, never an email supplied by a client. Choose and test customer ownership, recovery, account/team administration and bounded additional signers before connecting unattended agents.

The next payment milestone is provider-enforced EIP-712 recipient/token/network/amount constraints plus ABI's existing shared reservations, deposit reconciliation and wallet-specific signing selection, followed by an actual test-USDC x402 purchase and verified receipt. Ordinary `eth_sendTransaction` policies alone do not constrain x402 typed-data signatures. Native USDC on Base Sepolia is the initial target; customer funds and mainnet remain outside this trial.

Local verification uses isolated SQLite and synthetic provider responses with independent cryptographic signing keys. It covers concurrent creation, lost responses, cross-workspace/role/CSRF denial, provider errors, changed app IDs and wrong-key signatures while asserting financial balances/card controls stay unchanged. Browser checks cover desktop/mobile creation and verification through Next → API → isolated SQLite/provider fixture. These results do not prove that real Privy credentials work; record live provider results separately after a real owner invokes the deployed trial.
