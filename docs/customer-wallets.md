# Customer-owned workspace wallets

ABI prepares one distinct user-owned Privy EVM wallet per workspace. This is a mainnet preparation release, not an activation of real-money deposits or agent payments. Existing organization custody, Base Sepolia balances, application-controlled trial wallets and their ledger references stay intact.

## Account and workspace lifecycle

Google/GitHub sign-in verifies the Supabase subject and binds it to the ABI user. Matching email alone cannot claim an existing account. Account completion and workspace creation persist a pending customer-wallet record without waiting for Privy. Opening Overview or Wallet attempts provisioning after authentication; provider outages leave the account and workspace usable, with a visible retry in Wallet. A local password-only account must first explicitly link its Google/GitHub identity.

A non-revoked human workspace owner is required. Guardian keys and agent API keys cannot provision a customer wallet. Each workspace records an immutable owning ABI user, Supabase subject and Privy app hash. Other owners cannot silently take it over; shared custody and ownership transfer require a separate explicit flow.

The provider adapter uses `@privy-io/node` 0.39.0. It looks up or creates the Privy custom-auth user by the verified Supabase subject, then creates an Ethereum wallet with an explicit `owner.user_id`. No server-owned fallback or app co-signer is added. A stable external ID derived from app, organization and workspace makes concurrent requests and lost create responses recoverable. The original request UUID is retained across retries. Existing provider wallets are recovered by external ID before another create attempt.

Before marking ownership verified, ABI requires a fresh, expiring, non-payment EIP-712 proof signed using the verified user's JWT and checks its ECDSA signature against the recorded wallet address. Changed owner quorum, address, wallet ID or app configuration fail closed. Provider errors are sanitized; JWTs, authorization keys and private keys are not persisted or returned to the browser. Each operation has its own SDK instance and bounded requests.

## Provider configuration

Configure custom/JWT authentication in the existing Privy app using:

- JWKS: `https://ijrjcpegrghlgcnouvbc.supabase.co/auth/v1/.well-known/jwks.json`
- Issuer: `https://ijrjcpegrghlgcnouvbc.supabase.co/auth/v1`
- Audience: `authenticated`
- User ID claim: `sub`

Supabase currently publishes an ES256 signing key; no key rotation is required for this setup. Keep `PRIVY_APP_SECRET` only in the existing API Worker's secret binding. The public app ID is tracked in Wrangler configuration. A configured secret alone does not establish successful customer authorization: a signed-in user's real ownership proof remains required.

## Currency selector and activation boundary

Wallet's glass card opens a custom currency/network dialog. The supported catalog is ETH and native USDC on Base (8453) and Ethereum (1). These EVM assets share the wallet's address, but network balances and USDC contracts differ. Circle's official contract list was checked on 15 November 2026: https://developers.circle.com/stablecoins/usdc-contract-addresses.

This release deliberately returns `receiveEnabled: false`, `spendingEnabled: false` and no public receiving address. No UI balance is inferred from provider creation; no ETH-to-USDC conversion is assumed. The actual address is stored privately only after ownership proof. Deposits, withdrawals and agent payments await a verified recovery/withdrawal path, mainnet reconciliation and bounded delegated signing. There is no environment variable that bypasses this boundary. Changing legacy `CHAIN` to `base` is not a migration and must not be used as an activation shortcut. Internal workspace allocation remains a ledger allocation, not an on-chain transfer between these new wallets.

## Verification

Local tests cover durable distinct workspace wallets, duplicate attempts, response loss, wrong identities, revoked owners, cross-workspace denial, changed app/owner, invalid signatures, sanitized provider errors, explicit SDK ownership, API-key denial, CSRF and account/workspace survival during provider failure. Browser fixtures exercise the currency dialog through the actual frontend/API/SQLite path. They do not establish live Privy custom-auth success or movement of real funds.
