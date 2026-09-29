# ABI next-build plan

## Product boundary

ABI is the financial control plane between autonomous software and money.

- The organization owns the treasury.
- A group owns a shared budget envelope.
- An agent receives authority to request spending from that budget under its own policy.
- The agent never owns funds or a private key.
- ABI decides, holds, approves, settles, reconciles, and explains each action.

The current console is primarily the **buyer/operator side**. The seller product should be a separate Merchant Gateway workspace sharing identity, organization, audit, and design foundations.

## Recommended order

### 1. Finish the authority model and migration

Goal: make “treasury → group budget → agent policy → payment” the only valid money path.

Progress: budget resolution now fails closed when an agent has no funded group,
has an archived/unfunded membership, or has multiple memberships that could
select a budget. The compatibility migration creates a group only for a legacy
agent with a remaining individual balance. Historical balances remain in the
ledger; the remaining migration and attribution work below is still open.
Reassignment now blocks pending approvals, unsettled payments, locked escrow,
and held funds; it transfers a legacy available balance to the selected budget
with a balanced journal. The owner can edit an organization profile in Settings.
These changes do not complete the authority model or production launch gates.

- Migrate any legacy agent balances into chosen group budgets.
- Require exactly one primary funded group for every active agent.
- Treat labels/tags separately from funding groups so one concept does not serve two jobs.
- Remove legacy agent allocation, reclaim, transfer, and auto-fund APIs after a deprecation window.
- Show the affected group budget and policy on every request, approval, payment, and audit event.
- Add regression tests for allow, deny, review, held funds, refunds, reassignment, and concurrent agents sharing one budget.

This phase should be completed before adding custody because the custody provider must implement a stable authority model.

### 2. Organization onboarding, profile, and real identity

Goal: turn account creation into a trustworthy organization setup flow.

Onboarding steps:

1. Personal identity: name, verified email, password or passkey.
2. Organization: legal/display name, website, country, timezone, organization type, intended use.
3. Workspace: buyer, seller, or both.
4. Team: invite members and choose roles.
5. Security: MFA/passkey, recovery codes, session review.
6. Treasury mode: sandbox first; live activation remains gated.
7. First group budget, first policy, and first agent.

Organization profile:

- Logo, display name, legal name, website, description.
- Country, timezone, default currency display, notification preferences.
- Organization ID, environment, plan, verification/live status.
- Members, invitations, roles, authentication methods, active sessions.
- Separate dangerous-actions area for ownership transfer, export, freeze, and deletion.

Authentication work:

- Verified email, password reset, secure session cookies, session rotation and revocation.
- Passkeys or OAuth, MFA and step-up authentication for sensitive actions.
- Organization invitations and role-based access control.
- Rate limits, lockout/abuse protection, security audit events and recovery flows.

Most of this can be built locally and tested on free tiers. Production email delivery, SMS-based MFA, higher-volume identity services, and monitoring may create operating cost; the architecture should not require a paid identity vendor to begin.

### 3. Settings redesign and language system

Goal: make settings calm, predictable, and understandable, using the structural strengths of ChatGPT settings without copying its branding.

- A narrow settings navigation column and one focused content panel.
- Sections: General, Organization profile, Members & roles, Security, Notifications, Environments, Integrations, Merchant Gateway, Billing/plan, Data & privacy, Developer, Danger zone.
- One topic per screen; progressive disclosure for advanced fields.
- Persistent save state, validation next to fields, and clear consequences before sensitive changes.
- Responsive full-screen settings navigation on mobile.

Copy system:

- Create one terminology glossary and ban ambiguous synonyms.
- Prefer human outcomes: “Needs approval” over raw state names; “Group budget” over “department wallet”; “Payment request” over “intent” in the UI.
- Every empty state should say what this area is, why it matters, and the next action.
- Every cross-page action should provide a direct result link, for example: “Approval created — View approval.”
- Keep raw API errors in developer logs; show concise, actionable messages to operators.
- Audit landing page, onboarding, navigation, Overview, Money, Agents, Controls, Developers, Merchant Gateway, and Settings as one copy pass.

### 4. Merchant Gateway seller workspace

Goal: let a seller expose an API or digital resource that agents can purchase through x402 and let the seller operate the resulting business.

Seller navigation:

- Overview: sales, successful payments, failed requests, settlement state.
- Products: protected endpoints/resources, descriptions, access terms.
- Pricing: fixed, usage-based, subscription/access-pass, and quote-required models.
- x402 tester: make a request, inspect the 402 challenge, payment proof, and unlocked response.
- Payments: receipts, payer agent/organization metadata where permitted, transaction hash, refunds.
- Customers & agreements: allowlists, negotiated prices, limits and service terms.
- Settlement: destination wallet, network/asset, reconciliation, export.
- Developers: server SDK, middleware snippets, webhook keys, logs.
- Settings: seller profile, branding, notifications, compliance information.

Merchant onboarding:

1. Create seller profile.
2. Add a resource or API endpoint.
3. Choose price and access duration.
4. Connect settlement destination.
5. Install ABI middleware or use the hosted gateway.
6. Pass a sandbox 402 test.
7. Publish to an optional ABI service directory.

Keep buyer and seller navigation separate, with a workspace switcher for organizations using both. Do not overload the buyer console with seller operations.

### 5. Coinbase CDP managed custody through a provider interface

Goal: replace application-managed signing without making ABI dependent on one vendor.

- Keep a `WalletProvider` boundary for create wallet, get address/balance, sign/submit transaction, estimate fees, and fetch receipt.
- Implement Coinbase CDP as the first managed provider.
- Preserve a local/test provider for deterministic tests.
- Map ABI organizations/groups to provider wallet/account identifiers without exposing keys to browsers or agents.
- Add idempotency keys, webhook verification, transaction state reconciliation, provider outage handling, and a provider migration/export strategy.
- Prove Base Sepolia end to end before any mainnet activation.

Provider fees and production usage are an operational dependency, not a reason to block the earlier product work. Confirm current pricing and account requirements immediately before integration.

### 6. Production payment foundation

Goal: make a real payment safe to retry, explain, and reconcile.

- PostgreSQL with migrations and tenant isolation.
- Durable job queue for settlement, receipt confirmation, webhook delivery, and recovery.
- Idempotency across request, approval, signing, broadcasting, and ledger posting.
- Formal state machine for proposed, denied, awaiting approval, authorized, submitted, confirmed, failed, reversed, and refunded.
- Real x402 V2 buyer and seller interoperability tests.
- Canonical Base transaction hash and explorer link.
- Ledger-to-chain reconciliation and visible exception queue.
- Structured logs, traces, metrics, alerts, uptime checks, backups and restore drills.
- Emergency organization/group/agent freezes and custody-provider circuit breaker.

### 7. Privacy, accessibility, and launch hardening

- No guardian, agent, session, or custody secrets in persistent browser storage.
- Encrypt sensitive values at rest; minimize retention and redact logs.
- Data export/deletion and organization retention controls.
- Keyboard-complete operation, screen-reader names, focus management, reduced-motion mode, contrast checks and responsive tables.
- Threat model, dependency and secret scans, penetration test, incident runbooks and disaster recovery.
- Reconcile product claims, API reference, SDK examples and deployment documentation with proven behavior.

## Near-term delivery blocks

| Block | Deliverable | Paid dependency required? |
| --- | --- | --- |
| A | Group-budget migration, tests, cross-page links | No |
| B | Organization profile, onboarding schema, settings shell | No |
| C | Terminology glossary and full product copy pass | No |
| D | Seller workspace shell and sandbox Merchant Gateway flow | No |
| E | Production authentication hardening | Not necessarily; some delivery/scale services may cost |
| F | Coinbase CDP provider and Base Sepolia proof | Account/provider requirements must be verified |
| G | PostgreSQL, queues, observability and live reconciliation | Can start free; production capacity costs later |

## Definition of the next convincing demo

1. A verified user creates an organization.
2. The organization creates and funds a Research group budget.
3. It creates an agent in that group and gives the agent a policy.
4. An external agent reaches a seller resource and receives an x402 challenge.
5. ABI evaluates the group budget and agent policy and returns allow, review, or deny in plain language.
6. If allowed, managed custody submits Base Sepolia USDC.
7. The seller unlocks the resource.
8. Buyer and seller consoles show the same authentic transaction hash and reconciled receipt.
9. The audit trail explains who requested, what policy decided, which budget paid, and what was delivered.

That demo proves ABI's complete thesis without requiring mainnet funds.
