/**
 * Workflow builder — the user-authored run sheet.
 *
 * In live mode this IS the workflow: pick an agent, list the real actions it
 * should take, run them under live policy. Every spend step defaults to a dry
 * run (policy simulation, no money moves); real spend is an explicit opt-in.
 * Training (sandbox practice) can register extra step kinds such as red-team
 * drills through `extraKinds` — the builder never imports training itself.
 */
import {
  acceptDelivery,
  buyViaX402,
  checkBudget,
  costTable,
  dryRun,
  hirePeer,
  listActivity,
  payToWallet,
  payVendor,
  refundEscrow,
  summarize,
} from "./steps";
import type { Mission, StepDef } from "./types";

export type CoreStepKind =
  | "budget"
  | "simulate"
  | "pay_api"
  | "pay_wallet"
  | "x402"
  | "escrow_lock"
  | "escrow_release"
  | "escrow_refund"
  | "activity"
  | "summarize";

/** Core kinds plus whatever an extension (training) registers. */
export type CustomStepKind = CoreStepKind | (string & { readonly __ext?: true });

export type CustomStepDraft = {
  id: string;
  kind: CustomStepKind;
  amount?: string;
  destination?: string;
  memo?: string;
};

export type StepCatalogEntry = {
  kind: CustomStepKind;
  label: string;
  needsAmount?: boolean;
  needsDestination?: boolean;
  /** Moves money (or locks it) when real spend is on. */
  spends?: boolean;
  detail: string;
};

export const CUSTOM_STEP_CATALOG: StepCatalogEntry[] = [
  { kind: "budget", label: "Check budget", detail: "Ask ABI what the agent can still spend." },
  {
    kind: "simulate",
    label: "Dry-run pay",
    needsAmount: true,
    needsDestination: true,
    detail: "Policy outcome only — no money moves.",
  },
  {
    kind: "pay_api",
    label: "Pay vendor (API)",
    needsAmount: true,
    needsDestination: true,
    spends: true,
    detail: "pay_api against allowlists + caps. Dry run unless real spend is on.",
  },
  {
    kind: "pay_wallet",
    label: "On-chain wallet pay",
    needsAmount: true,
    needsDestination: true,
    spends: true,
    detail:
      "USDC.transfer from the vault to a 0x address on your Policy allowlist — any wallet, or another ABI account's vault address (not your own). With real spend on it is a real on-chain transfer (Base Sepolia testnet USDC in sandbox too). Dry run unless real spend is on.",
  },
  {
    kind: "x402",
    label: "Buy x402 report",
    needsAmount: true,
    spends: true,
    detail: "Full x402 handshake against the configured seller. Dry run unless real spend is on.",
  },
  {
    kind: "escrow_lock",
    label: "Escrow hire peer",
    needsAmount: true,
    spends: true,
    detail: "Lock funds to hire the other agent. Dry run unless real spend is on.",
  },
  {
    kind: "escrow_release",
    label: "Release escrow",
    spends: true,
    detail: "Accept deliverable and pay the peer.",
  },
  {
    kind: "escrow_refund",
    label: "Refund escrow",
    spends: true,
    detail: "Reject deliverable; funds return.",
  },
  {
    kind: "activity",
    label: "Pull activity",
    detail: "Fetch recent policy decisions for this agent.",
  },
  { kind: "summarize", label: "Compile summary", detail: "Close the run and report spend." },
];

/** An extension step kind (registered by training for sandbox practice). */
export type ExtraStepKind = StepCatalogEntry & {
  build: (d: { amount: string; dest: string; id: string }) => StepDef;
  defaults?: { amount?: string; destination?: string };
};

export type CompileOptions = {
  /** Off by default: spend steps become policy simulations. */
  realSpend?: boolean;
  extraKinds?: ExtraStepKind[];
  /** Stable id (used to resume a run after reload). */
  id?: string;
  sellerUrl?: string | null;
};

const skipped = (id: string, title: string, why: string): StepDef => ({
  id,
  title,
  detail: why,
  async run() {
    return { summary: why, output: why };
  },
});

function asDryRun(step: StepDef, id: string): StepDef {
  return { ...step, id, title: `Dry run · ${step.title.replace(/^Dry-run /, "")}` };
}

export function stepFromDraft(d: CustomStepDraft, opts: CompileOptions = {}): StepDef {
  const amount = (d.amount ?? "1").trim() || "1";
  const dest = (d.destination ?? "api.openai.com").trim() || "api.openai.com";
  const memo = (d.memo ?? "custom mission step").trim() || "custom mission step";
  const real = !!opts.realSpend;
  const extra = opts.extraKinds?.find((k) => k.kind === d.kind);
  if (extra) return { ...extra.build({ amount, dest, id: d.id }), id: d.id };
  switch (d.kind) {
    case "budget":
      return { ...checkBudget, id: d.id };
    case "simulate":
      return { ...dryRun(amount, dest), id: d.id };
    case "pay_api":
      return real
        ? { ...payVendor(amount, dest, memo), id: d.id }
        : asDryRun(dryRun(amount, dest), d.id);
    case "pay_wallet":
      return real
        ? { ...payToWallet(amount, dest), id: d.id }
        : asDryRun(dryRun(amount, dest), d.id);
    case "x402":
      return real
        ? { ...buyViaX402(amount), id: d.id }
        : asDryRun(dryRun(amount, opts.sellerUrl || "x402 seller"), d.id);
    case "escrow_lock":
      return real
        ? { ...hirePeer(amount), id: d.id }
        : skipped(d.id, `Dry run · hire peer for $${amount}`, "Dry run: escrow is not locked.");
    case "escrow_release":
      return real
        ? { ...acceptDelivery, id: d.id }
        : skipped(d.id, "Dry run · release escrow", "Dry run: nothing to release.");
    case "escrow_refund":
      return real
        ? { ...refundEscrow, id: d.id }
        : skipped(d.id, "Dry run · refund escrow", "Dry run: nothing to refund.");
    case "activity":
      return { ...listActivity, id: d.id };
    case "summarize":
      return { ...summarize, id: d.id };
    default:
      return { ...checkBudget, id: d.id };
  }
}

/** Compile a user-authored step list into a runnable Mission (same runner as presets). */
export function compileCustomMission(
  input: { title: string; brief?: string; steps: CustomStepDraft[] },
  opts: CompileOptions = {},
): Mission {
  const steps = input.steps.length ? input.steps : [{ id: "budget", kind: "budget" as const }];
  const title = input.title.trim() || "Custom mission";
  const real = !!opts.realSpend;
  return {
    id: opts.id ?? `custom_${Date.now().toString(36)}`,
    title,
    persona: "Your conditions",
    category: "ops",
    expectedOutcome: "mixed",
    difficulty: "advanced",
    duration: `${Math.max(1, Math.ceil(steps.length / 3))}–${Math.max(2, Math.ceil(steps.length / 2))} min`,
    estimatedCost: real ? `Up to $${maxSpend(steps).toFixed(2)}` : "$0 (dry run)",
    tags: ["custom", real ? "real spend" : "dry run"],
    brief:
      input.brief?.trim() ||
      (real
        ? "Your run sheet, executed for real under live policy — spend steps move money."
        : "Your run sheet as a dry run — every spend step asks the policy engine what would happen, and no money moves."),
    deliverableKind: "Custom mission record",
    build: () => steps.map((s) => stepFromDraft(s, opts)),
    deliverable: (state) => `# ${title}

Custom mission run under live ABI policy${real ? "" : " (dry run — no money moved)"}.

## What this cost

${costTable(state)}

## Outcomes

- Settled purchases: ${state.purchases.length}
- Parked / blocked: ${state.blocks.length}
- Refused: ${state.denials.length}${
      state.denials.length ? ` (${state.denials.map((d) => d.code).join(", ")})` : ""
    }
- Remaining agent budget: **$${state.finalBudget ?? "—"}**
`,
  };
}

const SPEND_KINDS = new Set(["pay_api", "pay_wallet", "x402", "escrow_lock"]);

/** Upper bound of what a run sheet could spend if real spend were on. */
export function maxSpend(steps: CustomStepDraft[]): number {
  return steps
    .filter((s) => SPEND_KINDS.has(s.kind))
    .reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
}

export function newCustomStep(
  kind: CustomStepKind = "pay_api",
  extraKinds: ExtraStepKind[] = [],
): CustomStepDraft {
  const extra = extraKinds.find((k) => k.kind === kind);
  const meta = extra ?? CUSTOM_STEP_CATALOG.find((c) => c.kind === kind);
  return {
    id: `cs_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e4)}`,
    kind,
    amount:
      extra?.defaults?.amount ??
      (meta?.needsAmount ? (kind === "pay_wallet" ? "0.10" : "5") : undefined),
    destination:
      extra?.defaults?.destination ??
      (meta?.needsDestination ? (kind === "pay_wallet" ? "" : "api.openai.com") : undefined),
    memo:
      kind === "pay_api"
        ? "custom spend"
        : kind === "pay_wallet"
          ? "e2e sepolia wallet proof"
          : undefined,
  };
}

/** Default run sheet: read-only + simulation, nothing that moves money. */
export function defaultRunSheet(): CustomStepDraft[] {
  return [
    newCustomStep("budget"),
    newCustomStep("simulate"),
    newCustomStep("pay_api"),
    newCustomStep("summarize"),
  ];
}
