type Budget = { id: string; status: string };
type OpsGroup = { budgetId?: string; status: string };

/** Setup is complete when an existing budget has a non-archived ops group.
 * Funding, agent activity and temporary freezes are separate operational states.
 */
export function hasBudgetOpsSetup(
  budgets: readonly Budget[],
  groups: readonly OpsGroup[],
): boolean {
  const budgetIds = new Set(
    budgets.filter((budget) => budget.status !== "archived").map((budget) => budget.id),
  );
  return groups.some(
    (group) => group.status !== "archived" && !!group.budgetId && budgetIds.has(group.budgetId),
  );
}
