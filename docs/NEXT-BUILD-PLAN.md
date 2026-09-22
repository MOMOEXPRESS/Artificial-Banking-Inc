# ABI next build plan

Updated: 2026-09-22. This plan reflects the deployed console, the x402 V2 Base
Sepolia proof, and the owner's requirement to keep the demo free and use only
valueless testnet tokens. It supersedes the immediate priorities in the July
roadmap and the 2026-09-21 audit; those documents remain useful historical audits.

## The product we are building

ABI gives organizations a controlled way to let AI agents buy API resources:
the agent requests a payment, ABI evaluates deterministic policy, people review
exceptions, x402 settles with a seller, and a ledger and receipt explain what
happened. The first buyer and merchant experience is **Base Sepolia test USDC**.
Base Sepolia is a test network, not a currency or a production payment option.

## What is already demonstrated

| Capability                | Current evidence                                                                                                                                                      | Limit                                                                                     |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Console and account login | Deployed Vercel console and persistent API                                                                                                                            | Keep testing new user sign-in and demo flows                                              |
| Agent control path        | Policy, approval re-check, idempotency, ledger, scoped keys                                                                                                           | Compliance screening remains a stub                                                       |
| x402 V2 payment           | A 0.01 test USDC payment with an authentic [BaseScan transaction](https://sepolia.basescan.org/tx/0x5a923e17847112d5bb9a521946cd834d54a09954bdee1ef94b5599de746c7f3c) | One funded external proof, not a production reliability record                            |
| Merchant Gateway          | Create seller profile, check unpaid x402 V2 challenge, show verified configuration                                                                                    | Verification checks endpoint configuration, not seller legal identity or wallet ownership |
| Developer entry           | REST, MCP, TypeScript SDK and examples                                                                                                                                | SDK has not been published to npm                                                         |
| Browser secrets           | Account sessions use httpOnly cookies; old key login stays in memory                                                                                                  | Legacy key flow still needs a deliberate migration path                                   |

See [the proof record](X402-BASE-SEPOLIA-PROOF.md) for the exact transaction,
buyer/seller addresses, and remaining live checks.

## Recommended sequence

### 1. Finish the testnet payment proof — now

- **Done:** x402 V2 buyer/seller, external facilitator, authentic hash, and
  receipt in Transactions.
- **In progress:** automated HTTP payment regression that proves a repeated
  idempotency key makes one seller request and one ledger posting; ledger
  genesis replay agrees after the payment. The test uses a synthetic local
  seller receipt and must never be reported as an on-chain transaction.
- **Still needed:** repeat the payment once on a funded _new_ test organization,
  replay the same key, verify that no second BaseScan transfer appears, then
  record a post-payment ledger reconciliation. The earlier demo credentials
  were retired. Do not regenerate or expose secrets just to tick a checkbox.
- **Gate:** documented transaction, idempotency, books, and a failed price or
  policy case, each with a trace a reviewer can reproduce.

### 2. Make the Merchant Gateway usable by another seller

- Turn today's Settings form and sample seller into a concise self-service
  flow: endpoint URL, payout address, network, test price, challenge check,
  actionable error, and a copyable seller integration example.
- Give the seller a reusable x402 middleware/config example and a checklist
  for successful HTTP 402, fulfillment, receipt, and failure handling.
- Expose seller activity and the authentic transaction hash in a merchant
  view. Keep seller identity verification and payout-wallet ownership as
  explicit later controls; the current verifier proves protocol configuration.
- **Gate:** an independent test seller can configure an endpoint and receive a
  test USDC payment without editing ABI source.

### 3. Harden the production foundation before real funds

- Move signing to a real managed custody or noncustodial wallet integration;
  document the legal/operating model with counsel before choosing. An app key
  encrypted at rest is still application-managed custody.
- Move from single-instance SQLite to transactional Postgres with a migration,
  idempotent outbox/jobs, backups, and recovery drills. Neon may be evaluated
  for the database; a database service does not replace the persistent API.
- Add real compliance screening, incident response, reconciliation alerts,
  secret rotation, and fund-flow limits. Prove failure and restart behavior.
- **Gate:** independent review and operational controls before live USDC or
  customer balances. This phase is a future funding/partner track, not a
  prerequisite for the free YC testnet demonstration.

### 4. Add the features that demonstrate ABI's advantage

- Show the exact policy trace beside every payment and approval; make policy
  simulation and replay obvious before changing limits.
- **Done in this block:** shared rolling 24h per-merchant endpoint ceilings,
  configured under Policy → Budgets. They aggregate settled ABI spend across
  agents, reserve headroom for payments in progress, and recheck approvals.
  Merchant registration does not grant permission: the agent's allowlist remains
  separate. These ceilings do not include payments outside ABI.
- Still needed: clearer approval/payment policy traces, recurring payments
  with human exception handling, and receipt/search workflows.
- Publish the TypeScript SDK after its public API is stable; add a minimal
  Python client for agent teams. Offer a small MCP or ChatGPT-driven demo that
  proposes spending but never holds the wallet key.
- **Gate:** a new operator can explain who spent, why ABI allowed it, who
  approved it if needed, and where the seller received the funds.

### 5. Privacy and accessibility in each product block

- Keep guardian, agent, signing, and webhook secrets out of persistent browser
  storage. Make account-cookie login the default and remove old key persistence
  only with a migration that preserves access to existing test organizations.
- Keep model egress opt-in; redact sensitive data from logs and responses;
  add retention and export/deletion controls as the product starts collecting
  more customer data.
- Check keyboard access, screen reader names and states, contrast, reduced
  motion, and small-screen layout for each new workflow. Use task-based manual
  tests, not only automated accessibility scans.

### 6. Scale when real usage requires it

- Keep one authority for policy + ledger decisions; make each settlement
  recoverable, idempotent, and observable across retries.
- Separate API, job runner, database, custody provider, and seller adapter
  behind stable interfaces; add transactional outbox and durable queues when
  multi-instance deployment is needed.
- Load-test actual money paths and fault-inject API, custody, facilitator,
  RPC, and database failures before adding replicas or new chains.

## First working block

1. Add the automated x402 HTTP replay and ledger-conformance regression.
2. Publish this current plan and update historical docs to point here.
3. Build the seller-facing onboarding and activity slice next.
4. Schedule the two remaining **live** proof checks only when a funded,
   disposable Base Sepolia organization is available; the test is free but
   requires fresh credentials and faucet tokens.

This order turns the verified payment into a repeatable product experience
while preserving a clean line between the testnet demo and a real-money launch.
