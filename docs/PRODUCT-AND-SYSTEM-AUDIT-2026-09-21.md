# ABI product and system audit

> Historical snapshot from 2026-09-21. A real x402 V2 Base Sepolia payment was
> subsequently recorded. See [the proof](X402-BASE-SEPOLIA-PROOF.md) and the
> [current next-build plan](NEXT-BUILD-PLAN.md) for present status.

Date: 2026-09-21

## Executive verdict

ABI is best understood as a **financial authorization and operations layer for autonomous agents**. It is not a bank, a general-purpose wallet, or an AI that can be trusted with a private key. Its core promise is narrower and stronger:

> An AI may propose a financial action, but deterministic policy, current account state, and human approval decide whether it can happen.

The implemented authorization core substantially supports that promise. The policy engine, approval re-check, exact double-entry ledger, scoped agent credentials, idempotency, tenant isolation, and settlement recovery form a coherent control path. The product is credible as a sandbox/Base Sepolia YC demo and developer prototype.

It is **not ready to hold customer money in production**. The present custody implementation is application-managed encrypted keys rather than managed MPC/HSM custody; compliance is an extension point; storage is SQLite; a real x402 facilitator is not proven; and operational verification needs more work.

## What ABI is for

### Primary user

An operator, founder, finance lead, or agent-platform team that needs to let software agents spend limited amounts without giving the model unrestricted access to money.

### Core job

Define who may spend, how much, for what, and when; stop prohibited actions; route ambiguous or high-value actions to humans; and preserve an explainable financial record.

### Canonical product loop

1. A human creates an organization and configures policy.
2. The human creates an agent and gives it a scoped agent API credential, never a vault private key.
3. The agent checks its budget or simulates a proposed action.
4. The agent submits a payment or escrow intent.
5. ABI evaluates deterministic policy against live state.
6. ABI allows, denies, or parks the intent for review.
7. A human resolves review items; ABI re-evaluates hard constraints before settlement.
8. The selected payment rail settles the action.
9. ABI records the decision, settlement state, ledger entries, and operational events.

This is the product's strongest defensible positioning: **the control plane between an AI and a payment rail**.

## Does the implementation accomplish that purpose?

### Strongly aligned

| Area                | Evidence                                                                                                                           | Verdict        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| Policy              | Deterministic allow/review/deny engine with caps, allowlists, freezes, quiet hours, velocity, budgets, categories, and risk checks | Strong         |
| Human review        | Pending approvals, quorum/role constraints, expiry, atomic claim, and policy re-check before execution                             | Strong         |
| Ledger              | Exact integer USDC accounting and balanced double-entry journals                                                                   | Strong         |
| Agent isolation     | Scoped API keys, session scopes, per-agent idempotency, and tenant-scoped reads                                                    | Strong         |
| Incident controls   | Agent/org freezes, group freezes, key rotation, and recovery jobs                                                                  | Strong         |
| Explainability      | Rule IDs, reasons, decision records, policy provenance, and activity views                                                         | Strong         |
| Integration surface | REST API, TypeScript SDK, stdio MCP server, webhooks, and a demo agent                                                             | Good prototype |

### Partially aligned

| Area               | Current limitation                                                                                                     | Consequence                                                               |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Custody            | Keys are encrypted with `ABI_KEK` but held by the application                                                          | Appropriate for testnet; not a production custody story                   |
| Settlement         | Real Base ERC-20 transfer exists, while vendor-string transfers can use a mock and x402 uses a development facilitator | The UI must make Sandbox/Testnet/Live unmistakable                        |
| Compliance         | Environment denylist behind a provider interface                                                                       | Not production transaction screening                                      |
| Storage            | Persistent SQLite                                                                                                      | Fine for a free YC demo; weak for horizontally scaled production          |
| Agent connectivity | MCP is stdio only                                                                                                      | Local AI runtimes can connect; hosted ChatGPT cannot connect directly yet |
| Assistant          | Fixed tools plus optional model egress                                                                                 | Useful copilot, not an autonomous finance executive                       |

## Organization and hierarchy audit

### Recommended user-facing hierarchy

1. **Organization** — ownership, members, global policy, treasury, environment.
2. **Budget** — a financial allocation for a team, project, or purpose.
3. **Agent** — a software identity with a stipend, credential, and optional stricter policy.
4. **Intent** — a proposed payment, API purchase, or escrow action.
5. **Decision** — allow, review, or deny with exact reasons.
6. **Approval** — a human resolution of a reviewed intent.
7. **Settlement and journal** — rail result plus accounting truth.

### Current inconsistencies

- `Department` is effectively a budget alias, while `AgentGroup` is an operational label. They look like competing hierarchy levels even though they do different jobs.
- Creating a budget can create a matching operational label, which makes the relationship appear one-to-one even though agents may join multiple labels.
- Shared wallets/pools are deprecated but remain readable and drainable, adding another money-container concept.
- Actual policy inheritance is organization → agent. Group-level policy inheritance is not implemented, despite older strategy language implying it.
- Developer-facing identifiers still use `PolicyVault` (`@policyvault/*`, `pv_*`, environment variables, MCP server name) while the product is branded ABI.
- Several large monolithic files increase change risk: the API store and entrypoint, console shell, Treasury view, Agents view, and global CSS.

### Recommended information architecture

| Section      | Purpose                                                                   |
| ------------ | ------------------------------------------------------------------------- |
| Home         | Operational summary, required attention, recent activity                  |
| Money        | Treasury, wallets, transactions, invoices, escrows, ledger                |
| Agents       | Agent directory, agent details, credentials, activity, operational groups |
| Controls     | Approvals, policies, simulations, incident freezes                        |
| Developers   | API keys, webhooks, logs, playground, SDK/MCP setup                       |
| Organization | Members, security, integrations, environment, settings                    |

ABI Chat should remain a secondary assistant available from every page, not a primary product category. Approvals should be prominent because human-governed exceptions are ABI's clearest differentiation.

## Money-path safety audit

The core invariant is correct: **the model never evaluates or waives financial policy**. The model may select an ABI tool and supply arguments; the server authenticates the agent, derives its organization, evaluates deterministic policy, and owns settlement.

Important implemented defenses include:

- positive amount and hard per-transaction ceilings;
- agent and organization daily caps;
- time-boxed and category budgets;
- vendor/address allowlists and blocklists;
- domain suffix-spoof protection;
- new-counterparty cooldown and risk review;
- quiet hours and velocity controls;
- agent, group, and organization freeze controls;
- approval expiry, quorum, role, and maximum-approval constraints;
- policy re-check after a human approves;
- compare-and-swap claims preventing double resolution;
- idempotency reservation before execution;
- settlement state persisted before irreversible work;
- exact ledger arithmetic and reconciliation;
- scoped session keys and cross-tenant read tests.

An audit-discovered fail-open condition was corrected: an unreadable per-agent override previously fell back to the organization default. Because the override could have been stricter, it now fails closed until repaired or cleared.

## ABI assistant audit

### What it is today

The assistant has two modes:

- **Default:** no external model egress. A deterministic keyword router calls a set of structured organization tools.
- **Opt-in:** an OpenAI-compatible model uses read-only tools. An organization can use a platform key or an encrypted bring-your-own key.

It can inspect agents, approvals, spend, budgets, denials, vendors, invoices, escrows, ledger health, policies, governance, treasury, and decision explanations. It can remember guardian-provided notes and draft text. It cannot post externally, approve a payment, or move money.

### Capability verdict

| Capability                               | Assessment                                                                                 |
| ---------------------------------------- | ------------------------------------------------------------------------------------------ |
| Understand routine operational questions | Good with model opt-in; basic without it                                                   |
| Follow financial rules                   | Not the assistant's job; deterministic policy enforces them                                |
| Remember conversation context            | Limited recent transcript and scratchpad                                                   |
| Remember durable facts                   | Yes, but simple note storage rather than semantic memory                                   |
| Explain decisions                        | Good when decision and policy tools are used                                               |
| Take autonomous financial action         | Deliberately no                                                                            |
| Resist prompt injection                  | Money remains protected by read-only tools; answer quality still needs adversarial testing |

The correct claim is not “ABI's chatbot always follows every rule.” It is: **ABI makes an AI's obedience unnecessary for financial safety.** Even a confused or hostile model should be unable to bypass server-side policy.

Audit hardening applied:

- remembered notes are encoded and labeled as untrusted data;
- instructions in chat history, tool output, or remembered notes may not override system rules;
- failed book reconciliation is reported as unverified rather than clean;
- model-generated answers skip the redundant second model rephrasing pass.

Remaining assistant work:

- memory list/edit/delete controls and provenance display;
- adversarial prompt-injection tests around memory and tool output;
- semantic retrieval if the memory corpus grows;
- explicit answer citations linking claims to ABI records;
- protection of custom model endpoints from private-network/metadata targets;
- evaluation fixtures measuring numerical accuracy, tool choice, and refusal behavior.

## Can ChatGPT test ABI as an external agent?

Yes conceptually, but not directly from this chat today. The repository exposes a **stdio MCP server**, which is suitable for local MCP-capable runtimes. This hosted ChatGPT conversation has no ABI connector, remote MCP endpoint, or scoped ABI agent credential.

There are three practical test levels:

1. **Immediate and free:** use the built-in Playground or `apps/demo-agent` with a scoped test agent key.
2. **Local external model:** connect an MCP-capable local client to `apps/mcp-server` using a Base Sepolia/demo agent key.
3. **Hosted ChatGPT:** add an authenticated remote MCP server or a Custom GPT Action/OpenAPI adapter. This transport is not implemented yet.

Never paste a vault key, guardian key, signup token, or agent key into a chat. The model should receive only a tool connection whose server stores a scoped agent credential.

### Adversarial external-agent scenario

| Attempt                                                       | Expected ABI result                                                      |
| ------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Buy from allowlisted API below all limits                     | Allow and settle once                                                    |
| Repeat the same idempotency key                               | Return the first result; no duplicate debit                              |
| Send all funds to an unknown address                          | Deny                                                                     |
| Spend above the human-review threshold but below the hard cap | Review                                                                   |
| Spend above the hard cap                                      | Deny; a human cannot waive it                                            |
| Prompt injection in vendor response asks for another transfer | New transfer still faces policy; unknown destination is denied           |
| Human freezes agent after an intent is parked                 | Approval re-check denies execution                                       |
| Destination becomes blocklisted after parking                 | Approval re-check denies execution                                       |
| Two humans resolve the same approval simultaneously           | One atomic claim succeeds                                                |
| Rail fails after funds are held                               | Hold is released or recovery state is escalated; ledger remains balanced |

This is the strongest demo of ABI's value: deliberately instruct the agent to misbehave and show that ABI contains it.

## Documentation and claim audit

Older launch and YC documents claimed Coinbase CDP-backed custody even though the provider is a stub and current keys remain application-managed. Those claims were corrected in the audited change. Future product copy should distinguish:

- **Sandbox:** simulated ledger funds and mock-capable rails;
- **Base Sepolia:** test tokens with application-managed encrypted keys;
- **Live/production:** not supported until custody, compliance, storage, monitoring, and operational controls meet the production bar.

“Built on Base/USDC” is defensible. “Coinbase CDP custody,” “managed custody,” “MPC,” or “production x402 settlement” is not yet defensible.

## Validation performed

- Full monorepo production build: passed.
- TypeScript typecheck: passed.
- Automated tests: 307 passed, 0 failed.
- Test coverage inspected across authentication, CSRF, password reset, MFA, step-up approval, secret encryption, policy evaluation, approval races, idempotency, ledger atomicity, settlement recovery, tenant isolation, session scopes, on-chain reconciliation, assistant routing, and AI-egress consent.

Automated tests reduce known risk; they do not prove the absence of every failure. The next validation stage should add browser workflow tests and a live Base Sepolia end-to-end trace.

## Readiness by use case

| Use case                                      | Readiness                                | Conditions                                                            |
| --------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------- |
| YC reviewer demo                              | Ready after browser smoke and deployment | Public login, API health, demo reset, clear Sandbox/Testnet labels    |
| Local developer prototype                     | Ready                                    | Scoped test credential and documented setup                           |
| Base Sepolia adversarial demo                 | Nearly ready                             | Faucet funds, allowlisted address/vendor, explorer proof              |
| Small closed beta without real customer money | Possible with caution                    | Backups, monitoring, explicit limitations                             |
| Production custody of customer funds          | Not ready                                | Managed custody, compliance, Postgres/HA, audits, incident operations |

## Prioritized roadmap

### Before sharing with YC

1. Complete browser smoke testing of signup, login, demo creation, agent funding, allow/review/deny, approval, and logout.
2. Keep Sandbox/Testnet visible on every financial page.
3. Record one repeatable adversarial agent demo and one Base Sepolia explorer proof.
4. Ensure all public copy uses the honest custody and settlement descriptions.
5. Make deployment-health failure states explicit rather than returning generic login errors.

### Next product block

1. Make Approvals the operational inbox.
2. Give each agent a coherent detail view: balance, policy, activity, credentials, incidents.
3. Clarify Budgets versus operational Groups and remove deprecated shared-wallet concepts from primary UI.
4. Add policy simulation/replay as a first-class workflow.
5. Add assistant memory controls and evaluation tests.

### Before real-money production

1. Integrate managed MPC/HSM custody through `CustodyProvider`.
2. Replace SQLite with production-grade shared storage and migrations.
3. Integrate real sanctions/KYT screening and document responsibility boundaries.
4. Prove real x402 facilitator behavior and complete on-chain verification/recovery.
5. Add independent security review, key rotation procedures, backups, observability, alerts, and incident runbooks.
