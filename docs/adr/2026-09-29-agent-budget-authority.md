# Decision: Direct agent budget authority

**Status:** Accepted
**Date:** 2026-09-29
**Supersedes:** The July 21, 2026 Picture A decision in `2026-07-21-budgets-vs-team-membership.md`, specifically its stipend-wallet payment path and its rejected direct-budget-spend option.

## Decision

The organization vault holds custody funds. Agents do not own spendable funds. Each agent has one explicit active budget assignment (`agents.budget_id`), and authorized payments reserve and settle directly against that budget. Agent groups are descriptive and operational labels; membership cannot grant, change, or select spending authority.

Task or session limits may narrow the assigned budget authority. They cannot expand it or cause ABI to guess a budget from group membership.

## Migration and compatibility

- Existing group-to-budget associations migrate to an agent's assignment only when the agent's active group memberships resolve to exactly one distinct active budget.
- Multiple labels linked to the same budget are unambiguous. Multiple distinct budgets remain unassigned and require an owner decision.
- Older agents with only a legacy available balance can be migrated to a newly created budget through a balanced journal when the compatibility path is exercised.
- Legacy balances and journals remain auditable; assignment changes with unsettled payment activity are rejected.
- API and console surfaces expose direct budget assignment separately from group labels.

## Rationale

Budget accounting and authorization need one auditable source of spendable capacity. A personal stipend ledger duplicates allocation state and can drift from its source budget. Making the assignment explicit also lets an agent appear in multiple operational groups without changing which funds it can spend.

## Required invariants

- Every new payment has one organization, one assigned budget, one initiating agent, and one immutable transaction record.
- Group creation, membership, and label removal never move funds or change agent authority.
- Assignment changes are tenant-scoped, owner-authorized, and blocked while the agent has unsettled activity.
- Historical ledger entries are never deleted or rewritten.
