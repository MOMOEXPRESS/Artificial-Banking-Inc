/**
 * Workflow types — the real end-to-end run model.
 *
 * A Mission is an ordered plan of steps. Every step calls a production flow
 * (`lib/flows`) with the agent's own key or the console's authenticated
 * guardian client, so a run in the playground is the same traffic a real agent
 * and a real guardian produce. Guided scenarios, hints and testnet-only practice steps
 * live in `lib/playground/training` and are layered on top of these types.
 */
import type { AgentClient, GuardianClient } from "../flows/client";

export type StepStatus = "pending" | "running" | "done" | "blocked" | "failed" | "skipped";

export interface RunStep {
  id: string;
  title: string;
  detail: string;
  status: StepStatus;
  /** One-line plain-English result — the thing the console shows. */
  summary?: string;
  /** Raw API response, hidden behind a toggle. */
  output?: string;
  approvalId?: string;
}

export interface WorkflowCtx {
  /** The acting agent, authenticated with its own key. */
  agent: AgentClient;
  /** The signed-in guardian, through the console's authenticated fetch. */
  guardian: GuardianClient;
  agentId?: string;
  agentName?: string;
  payeeAgentId?: string;
  /** Public x402 seller endpoint. Null/empty when not configured for this host. */
  sellerUrl: string | null;
  runId: string;
  /** Base Sepolia receive address for agent on-chain wallet pay proof. */
  e2eWallet?: string;
  /** Small USDC amount for that proof (default 0.10). */
  e2eAmountUsdc?: string;
  emit: (steps: RunStep[]) => void;
  onBlocked: (step: RunStep) => void;
  onUnblocked: (step: RunStep, outcome: "approved" | "denied" | "expired") => void;
  log: (line: string) => void;
  cancelled: () => boolean;
}

/** Back-compat alias — the playground used to call this MissionCtx. */
export type MissionCtx = WorkflowCtx;

export interface Mission {
  id: string;
  title: string;
  brief: string;
  /** Buyer / operator persona this scenario models. */
  persona: string;
  /** Use-case bucket for the playground picker. */
  category: "commerce" | "governance" | "security" | "ops";
  /** The headline result an operator should expect from the exercise. */
  expectedOutcome: "allow" | "review" | "deny" | "mixed" | "observe";
  /** Helps people choose an appropriate exercise without reading every step. */
  difficulty: "starter" | "intermediate" | "advanced";
  /** Human-friendly estimates shown in the scenario library. */
  duration: string;
  estimatedCost: string;
  tags: string[];
  /** What the guardian gets to read at the end. */
  deliverableKind: string;
  build: (ctx: WorkflowCtx) => StepDef[];
  deliverable: (state: RunState) => string;
  /** Run these missions back-to-back instead of `build` (e.g. the smoke chain). */
  chain?: string[];
  /** Deliberately hostile or high-volume; blocked on live orgs. */
  destructive?: boolean;
  /** Changes org configuration (policy allowlist); testnet practice only. */
  editsPolicy?: boolean;
}

export interface RunState {
  spentUsd: number;
  report?: {
    rows?: { vendor: string; plan?: string; pricePerMonthUsd: number }[];
    generatedAt?: string;
  };
  escrowId?: string;
  blocks: { amount: string; destination: string; outcome: string }[];
  denials: { amount: string; destination: string; code: string; reason: string }[];
  purchases: { amount: string; destination: string; rail: string; txHash?: string }[];
  finalBudget?: string;
  webhookId?: string;
  webhookSecretShown?: string;
  webhookDeliveries?: { event: string; status: string; id: number }[];
}

export interface StepDef {
  id: string;
  title: string;
  detail: string;
  run: (ctx: WorkflowCtx, state: RunState) => Promise<StepResult>;
}

export interface StepResult {
  summary: string;
  output: string;
  approvalId?: string;
  softFail?: boolean;
  abort?: boolean;
}

export const newRunState = (): RunState => ({
  spentUsd: 0,
  blocks: [],
  denials: [],
  purchases: [],
});
