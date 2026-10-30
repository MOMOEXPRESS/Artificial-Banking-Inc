/**
 * Training layer — the playground's training wheels, isolated behind one flag.
 *
 * Everything here is optional on top of the real workflow (`lib/workflow`,
 * `lib/flows`): guided scenario catalog and hints, testnet-only practice setup steps,
 * red-team drills. Production code must not import this folder (enforced by
 * ESLint `no-restricted-imports` and `training-boundary.test.ts`); only the
 * playground view does, and only uses it when `isTrainingEnabled(org)`.
 */
import type { ExtraStepKind } from "../../workflow/builder";
import type { Mission } from "../../workflow/types";
import { drainAttempt } from "./steps";

export { MISSIONS, findMission } from "./catalog";
export { isTrainingEnabled, trainingBuildEnabled } from "./flag";

export const SCENARIO_GROUPS: {
  id: Mission["category"];
  label: string;
  description: string;
  icon: string;
}[] = [
  {
    id: "commerce",
    label: "Buy & transact",
    description: "x402 purchases, USDC settlement, escrow, and vendor payments.",
    icon: "wallet",
  },
  {
    id: "governance",
    label: "Approvals & controls",
    description: "Budgets, human review, policy simulation, and reconciliation.",
    icon: "shield",
  },
  {
    id: "security",
    label: "Security drills",
    description: "Adversarial requests and limits that must fail safely.",
    icon: "alert",
  },
  {
    id: "ops",
    label: "Connected workflows",
    description: "Webhooks, service connections, chains and coordinated agent work.",
    icon: "sliders",
  },
];

export const OUTCOME_LABEL: Record<Mission["expectedOutcome"], string> = {
  allow: "Expected: allow",
  review: "Expected: human review",
  deny: "Expected: deny",
  mixed: "Expected: mixed",
  observe: "Observe only",
};

/** Extra run-sheet steps available only in testnet practice. */
export const TRAINING_STEP_KINDS: ExtraStepKind[] = [
  {
    kind: "drain",
    label: "Red-team drain (practice only)",
    needsAmount: true,
    needsDestination: true,
    detail: "Attempt pay to an unapproved address (should refuse). Testnet practice only.",
    defaults: { amount: "5", destination: "0x1111111111111111111111111111111111111111" },
    build: ({ amount, dest }) => drainAttempt(amount, dest),
  },
];

/** Parse "Up to $8.50" style estimates for the budget check (0 when unknown). */
export function estimatedMaxUsd(mission: Pick<Mission, "estimatedCost">): number {
  const m = /\$([\d,]+(?:\.\d+)?)/.exec(mission.estimatedCost);
  return m ? Number(m[1].replace(/,/g, "")) : 0;
}
