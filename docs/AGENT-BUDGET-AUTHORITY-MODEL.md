# ABI agent, budget, and policy model

## Product decision

Agents do not own money. The organization vault holds funds. A budget is an authorization envelope that says what part of those funds may be used for a purpose. An agent receives permission to draw from one or more budgets while performing a task.

“Available to an agent” therefore means **spending capacity under the current budget and policy**, not a wallet balance belonging to the agent.

## The four layers of authority

An action is allowed only when every applicable layer permits it:

1. **Organization policy** — immutable ceiling for the organization: supported networks, global vendors, compliance requirements, maximum limits, and emergency controls.
2. **Budget policy** — the purpose-bound envelope: total amount, time window, categories, vendors, destinations, and approval thresholds.
3. **Agent capabilities** — what this identity may do: tools, actions, networks, destinations, and which budgets it may use.
4. **Task or session limits** — temporary restrictions for one job: selected budget, maximum task spend, expiry, and permitted counterparties.

The effective permission is the intersection of those layers. A lower layer may narrow authority but may never expand a stricter rule above it.

## Agent groups

The interface name is **Agent groups** (previously “Ops labels”). A group organizes agents for shared operational controls, such as:

- organizing agents by operational function;
- freezing a team during an incident;
- applying the same restrictive capability profile;
- viewing and reporting team activity.

A group is not a wallet, budget, or independent source of policy. An agent may belong to several groups, while spending authority is assigned directly to one active budget. Group labels never select or change that assignment. A task or session may narrow the agent's assigned budget access, but cannot expand it.

## Payment flow

1. The agent asks to perform an action under its assigned budget and supplies any required task context.
2. ABI calculates remaining budget capacity; it does not transfer money to the agent.
3. ABI intersects organization, budget, agent, and task rules.
4. ABI allows, denies, or creates a human approval request.
5. When allowed, the organization vault or custody wallet settles the payment.
6. The ledger attributes the result to the organization, budget, agent, task, vendor, and policy version.
7. The console shows an action receipt with direct links to every affected page.

## Action receipts

Every state-changing action should return a human-readable receipt containing:

- what happened;
- why ABI allowed, denied, or paused it;
- the amount and budget involved;
- what changed;
- which pages now contain the record;
- the next action, if one is required;
- optional technical details for developers.

Examples:

- “Payment paused. The Research budget permits the vendor, but payments above $50 require approval. Open Approvals.”
- “Payment completed. $8.20 USDC was paid from the Research budget. View Transactions or Treasury.”
- “Payment blocked. This destination is not allowed by the organization policy. No money moved. Open Policies.”

## Migration from the current stipend ledger

The current implementation holds ledger balances in agent accounts and calls them stipends. Replace that behavior in stages so existing records remain auditable:

1. **Language and navigation** — replace “stipend,” “fund agent,” and “agent wallet balance” with “budget access,” “assign budget,” and “spending capacity.” Keep legacy balances visibly marked during migration.
2. **Explicit budget authority** — store one `budgetId` on each agent; allow a clearly marked compatibility fallback only when old group links identify one unambiguous active budget.
3. **Authorization accounting** — reserve and spend against the assigned budget account. Keep the agent ID as attribution, not as the source of funds.
4. **API revision** — return `budgetAccess`, `remainingCapacity`, and `effectivePolicy`; deprecate `/v1/agent/budget` fields that imply agent ownership.
5. **Ledger migration** — move unused agent allocations into the assigned budget with balanced migration journals. Ambiguous legacy assignments require an owner to assign a budget before spending.
6. **Remove compatibility mode** — reject payments without budget context after SDKs and integrations have migrated.

Do not delete or rewrite historical journals. Historical agent balances should remain explainable as the previous funding model.

## Required invariants

- Total budget reservations cannot exceed vault funds available for allocation.
- The same dollar cannot be available in two budgets unless explicitly modeled as a non-exclusive planning limit.
- An agent cannot spend without an active budget assignment and task/session permission.
- Approval cannot bypass a hard organization prohibition.
- Re-check policy and budget capacity immediately before settlement.
- Every settled payment has one organization, one budget, one initiating agent, one policy version, and one immutable transaction record.
- Freezing an agent stops new authorization but does not erase history or strand an already-broadcast transaction.
