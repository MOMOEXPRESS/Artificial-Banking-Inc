/**
 * Quick-reply chips for the next turn, chosen from what was just shown and
 * the org's live state. Deterministic, read-only, and every chip is a question
 * the assistant can actually answer (never "approve it" or "send money").
 */
import type { OrgContext } from "./context.js";
import type { Scratchpad } from "./memory.js";
import type { ToolName } from "./tools.js";

export function suggestFollowUps(args: {
  intent?: string;
  toolsUsed: ToolName[];
  ctx: OrgContext;
  scratch?: Scratchpad;
}): string[] {
  const { intent, toolsUsed, ctx, scratch } = args;
  const out: string[] = [];
  const add = (s: string) => {
    if (!out.includes(s)) out.push(s);
  };
  const used = (t: ToolName) => toolsUsed.includes(t);
  const agent = scratch?.agentNames?.length === 1 ? scratch.agentNames[0] : undefined;
  const otherAgent = ctx.agents?.find((a) => a.name !== agent)?.name;

  if (used("recent_payments") || intent === "payments") {
    add("Explain the last one");
    if (scratch?.decisionIds && scratch.decisionIds.length > 1) add("Explain the second one");
  }
  if (used("agent_detail") && agent) {
    add(`Recent payments by ${agent}`);
    if (otherAgent) add(`And ${otherAgent}?`);
  }
  if (used("list_agents") && ctx.agents?.[0]) add(`How is ${ctx.agents[0].name}?`);
  if (used("explain_decision") || used("list_denials")) add("Show policy bands");
  if (used("get_policy")) add("Why was the last payment blocked?");
  if (ctx.pendingApprovals > 0 && !used("pending_approvals")) add("What's waiting on me?");
  if (ctx.pendingApprovals > 0 && used("pending_approvals")) add("Why is it waiting?");
  if (ctx.unreadNotifications && !used("notifications_digest")) add("Any new notifications?");
  if (ctx.last24h && ctx.last24h.deny > 0 && !used("list_denials") && !used("explain_decision"))
    add("Why was the last payment blocked?");
  if (intent === "action_request") add("What should I do next?");
  if (!used("recent_payments") && intent !== "payments") add("Show recent payments");
  add("What should I do next?");
  return out.slice(0, 4);
}
