# Account treasury and workspace governance

This release extends the current ABI design and existing enforcement paths. It does not migrate or sweep anyone’s funds, replace wallet addresses, enable mainnet agent purchases, bridge assets, or turn USD credits into USDC.

## Funding and ownership

The existing default General workspace’s verified Privy USDC wallet is the account treasury. Its identity and addresses are preserved. Native USDC on Base and Ethereum can be allocated to other workspaces internally. These network-specific allocations reserve a share of the treasury’s actual token holdings. No blockchain transfer occurs and no new on-chain wallet is needed. Returning an allocation reverses that reservation. The allocation event history is immutable and request-key idempotent.

New workspaces retain separate zero-funded ledger balances and cards, but no longer provision separate on-chain wallets automatically. Background provisioning initializes the default treasury and retries existing partial wallet setups. Owners may explicitly set up a separate workspace wallet. All previously provisioned wallets remain accessible; transfers to them use the existing reviewed on-chain path and incur network fees.

The account treasury is a presentation and allocation role for the existing default wallet, not a new custodial entity. Account owners retain custody controls. Other account roles do not receive treasury management permission.

Mainnet allocations, Base Sepolia agent allowance, and card-funded USD credits are distinct. Mainnet allocations cannot currently fund agent purchases. Existing General agents may still use the separate default ledger allowance; this release does not silently rebind them.

## Financial invariants

- An allocation cannot exceed confirmed, unallocated native USDC on its exact network.
- Capacity uses the lower of a three-block-confirmed balance and the latest balance. Recent outgoing transfers cannot restore spent capacity through an older snapshot.
- The transaction recomputes allocations after network reads and rejects a changed outgoing-transfer snapshot.
- Prepared (until expiration), submitting, submitted and unknown transfers block allocation changes.
- A treasury send cannot prepare against funds assigned to workspaces. An existing prepared send blocks new allocations until it resolves or expires.
- Frozen accounts/cards cannot change allocations. A balance below existing obligations requires reconciliation; no invented credit repairs it.
- USDC recovered at a different asset wallet remains separate from the principal treasury’s allocations.
- No allocation automatically sends funds, changes an agent cap, or bypasses an approval.

USDC transfer history scans the latest 2,000 confirmed blocks on each refresh, persists transaction-hash/log-index identities, and distinguishes deposits, withdrawals and self-transfers. It never credits funds from logs: holdings remain verified balance reads. Unavailable scans and limited historical coverage are explicit. Existing payment ledger history and internal allocation events remain separate to avoid reporting allocations as income.

## Limits and approvals

The existing card limit remains enforced. Additional daily, weekly and monthly caps apply simultaneously to every connected agent on the card. Periods are calendar UTC; weeks start Monday. Unresolved authorizations reserve capacity across resets. Removing an additional cap does not erase usage or remove the original card limit. Mainnet owner transfers use existing treasury withdrawal controls; these agent caps do not represent mainnet purchase support.

Existing advanced account policy controls are accessible through Billing: per-agent limits, allowlists and blocklists, quiet hours, rate limits, counterparty cooldowns, category budgets and simulation. Their actual scopes and existing defaults are retained. The legacy per-agent rolling 30-day cap is distinct from the new shared workspace calendar-month cap.

Workspace team controls use existing account Owner/Approver/Viewer roles. Owners retain access. Account viewers cannot be elevated to approvers inside a workspace. Owners can share a workspace with an account member, restrict them to viewing, set a per-person USDC approval ceiling, or remove access. Removed legacy access is not recreated by backfill.

Workspace quorum can only increase the account requirement. Eligible signed-in members vote on the existing approval queue. Votes from removed, restricted, revoked or over-limit members do not count. Owner-key and the corresponding owner-user identities do not count twice. Unreachable workspace quorum configurations are rejected. Existing account-wide memberships and invitations remain in Settings; this release does not introduce Admin/Operator account roles.

Changed configured governance invalidates bound pending approvals. Hard limits are checked at execution. A human approval does not bypass hard-deny quiet hours. Mainnet transfers needing multiple approvals fail closed under the existing unsupported-transfer guard rather than execute with one owner confirmation.

## Navigation and vendor organization

Billing exposes Overview with account treasury and allocations, Transactions and owner-only Workspace team. Workspace-card Settings holds the existing spending controls; Access keys and Activity are separate card tabs. The added full policy editor, invoice/approval tabs, saved-vendor strip and recovery panels are removed from this UI; backend enforcement, recovery and existing funds are preserved. Transactions show posted double-entry ledger movements for the caller’s existing access scope. The account treasury displays network-specific on-chain USDC history and allocation history. No real invoices or transactions are synthesized.

Workspace vendors can be filtered by industry and saved server-side per workspace. A saved vendor is an organizational preference; it is not an allowlist entry, an approved partnership, or permission to purchase. Existing provider readiness remains authoritative.

Console navigation and the floating dock use the rounded translucent treatment requested for the public navigation. Content stays in existing Inter/white/neutral-gray/blue surfaces. Mobile tabs scroll within their container and working dialogs stay opaque.

## Release checks

Use financial unit/HTTP tests for allocation conservation, concurrent allocation, replay, frozen states, reduced chain balances, pending transfers, unchanged addresses, token-history deduplication, simultaneous caps, rollover reservations, membership removal and owner-only endpoints. Run existing approval/stale-policy and frontend suites, API/frontend typechecks, Worker dry-run and production frontend build. Browser fixtures verify desktop/mobile forms with synthetic data only; do not ship the fixture route or interpret it as a real deposit test.

Deploy the API first using the existing `ABI API production` Cloudflare build trigger at the exact reviewed commit; it preserves existing bindings and variables. Deploy the frontend through the existing Vercel project after the backend is healthy. Verify the actual production commit and unauthorized route behavior; no production funds are moved by release validation.
