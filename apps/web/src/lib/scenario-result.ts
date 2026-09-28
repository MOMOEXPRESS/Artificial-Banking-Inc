import type { RunStep } from "./mission";
import type { View } from "./console-types";

export type PlainApiResult = {
  headline: string;
  facts: string[];
};

export type RelatedConsoleView = {
  view: View;
  label: string;
};

const humanRule = (value: string) =>
  value
    .replace(/^policy[.:_-]?/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const displayValue = (value: unknown): string | null => {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return null;
};

/**
 * Translate a machine response into the small set of facts an operator needs.
 * The original JSON is still available separately for developers and support.
 */
export function explainApiResponse(output: string, fallback?: string): PlainApiResult {
  let value: unknown;
  try {
    value = JSON.parse(output);
  } catch {
    return {
      headline: fallback || "ABI returned an update.",
      facts: output.trim() ? [output.trim()] : [],
    };
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      headline: fallback || "ABI completed this step.",
      facts: Array.isArray(value)
        ? [`ABI returned ${value.length} item${value.length === 1 ? "" : "s"}.`]
        : [],
    };
  }

  const data = value as Record<string, unknown>;
  const error =
    data.error && typeof data.error === "object" ? (data.error as Record<string, unknown>) : null;
  const outcome = String(data.outcome ?? data.decision ?? "").toLowerCase();
  const status = String(data.status ?? "").toLowerCase();
  const txHash = displayValue(data.txHash);
  const approvalId = displayValue(data.approvalId);
  const frozen = data.frozen === true;

  let headline = fallback || "ABI completed this step.";
  if (error) headline = "ABI could not complete this action.";
  else if (approvalId || outcome === "review" || status === "pending_approval")
    headline = "ABI paused this action for a person to approve.";
  else if (["deny", "denied", "blocked", "refused"].includes(outcome) || status === "denied")
    headline = "ABI blocked this action to protect the account.";
  else if (["allow", "allowed", "approved"].includes(outcome))
    headline = "ABI checked the rules and allowed this action.";
  else if (txHash || ["paid", "settled", "succeeded", "credited"].includes(status))
    headline = "The payment or transfer completed successfully.";
  else if (frozen) headline = "This agent is frozen and cannot spend.";

  const facts: string[] = [];
  const push = (text: string | null | undefined) => {
    if (text && !facts.includes(text)) facts.push(text);
  };

  const message = displayValue(error?.message ?? data.message ?? data.note);
  push(message);

  const amount = displayValue(data.amountUsdc ?? data.amount);
  if (amount) push(`Amount: $${amount} USDC.`);
  const available = displayValue(data.availableUsdc);
  if (available) push(`Budget capacity available: $${available} USDC.`);
  const today = displayValue(data.dailyRemainingUsdc);
  if (today) push(`Remaining under today’s limit: $${today} USDC.`);
  const destination = displayValue(data.destination ?? data.to);
  if (destination) push(`Recipient or service: ${destination}.`);
  const rail = displayValue(data.rail);
  if (rail) push(`Payment method: ${humanRule(rail)}.`);
  if (approvalId) push("An approval request was created and is waiting in Approvals.");
  if (txHash)
    push(`A blockchain transaction was recorded (${txHash.slice(0, 10)}…${txHash.slice(-6)}).`);

  const reasons = Array.isArray(data.reasons)
    ? data.reasons.filter((item): item is string => typeof item === "string")
    : [];
  for (const reason of reasons.slice(0, 2)) push(reason.endsWith(".") ? reason : `${reason}.`);

  const rules = Array.isArray(data.ruleIds)
    ? data.ruleIds.filter((item): item is string => typeof item === "string")
    : [];
  if (rules.length) push(`Rules involved: ${rules.slice(0, 3).map(humanRule).join(", ")}.`);

  if (!facts.length && status) push(`Status: ${humanRule(status)}.`);
  return { headline, facts: facts.slice(0, 6) };
}

/** Pages where this step leaves a visible record. Keeps operators oriented. */
export function relatedConsoleViews(step: RunStep): RelatedConsoleView[] {
  const text = `${step.id} ${step.title} ${step.summary ?? ""} ${step.output ?? ""}`.toLowerCase();
  const views: RelatedConsoleView[] = [];
  const add = (view: View, label: string) => {
    if (!views.some((item) => item.view === view)) views.push({ view, label });
  };

  if (step.approvalId || /approval|human review|parked|quorum/.test(text))
    add("approvals", "Approvals");
  if (/escrow/.test(text)) add("escrows", "Escrows");
  if (/webhook|delivery/.test(text)) add("webhooks", "Webhooks");
  if (/invoice/.test(text)) add("invoices", "Invoices");
  if (/x402|pay_|payment|wallet pay|withdraw|settled|transaction hash|txhash/.test(text))
    add("payments", "Transactions");
  if (/budget|treasury|deposit|on-chain|onchain|reconcil|backing/.test(text))
    add("treasury", "Treasury");
  if (/policy|simulate|allowlist|deny|denied|blocked|compliance|limit/.test(text))
    add("policy", "Policies");
  if (/agent group|session key|freeze|unfreeze|rotate key/.test(text)) add("agents", "Agents");
  if (/deliverable|report|summary|research brief/.test(text)) add("work", "Work");

  return views.slice(0, 3);
}
