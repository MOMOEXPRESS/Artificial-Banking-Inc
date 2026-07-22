/**
 * ABI Agent loop — conversation-aware org survey + reasoning over policy/quiet hours.
 *
 * Prefers OpenAI tool-calling when OPENAI_API_KEY is set; falls back to keywords.
 * Read-only money tools only. External actions are proposals until guardian approves.
 */
import { answerQuestion } from "../insights.js";
import { buildOrgContext, formatOrgContext } from "./context.js";
import {
  inferExternalArgs,
  type ExternalActionProposal,
} from "./external-actions.js";
import { runLlmToolLoop } from "./llm-loop.js";
import {
  buildScratchpad,
  lastScratchpad,
  resolveFollowUp,
  type ChatTurn,
  type Scratchpad,
} from "./memory.js";
import { anomalyNote, pickTools, runTool, type ToolName, type ToolResult } from "./tools.js";

export type AbiAgentResult = {
  answer: string;
  goto?: string;
  toolsUsed: ToolName[];
  externalAction?: ExternalActionProposal;
  via?: "llm" | "keywords" | "legacy";
  scratchpad?: Scratchpad;
};

function preferGoto(results: ToolResult[]): string | undefined {
  const order = [
    "approvals",
    "policy",
    "agents",
    "treasury",
    "activity",
    "escrows",
    "work",
    "overview",
    "chat",
  ];
  for (const g of order) {
    if (results.some((r) => r.goto === g)) return g;
  }
  return results[0]?.goto;
}

function composeAnswer(results: ToolResult[], orgId: string, includeContext = false): string {
  if (!results.length) {
    return "I couldn't find a matching survey tool — try asking about agents, spend, policy bands, or quiet hours.";
  }
  const blocks = results.map((r) => `${r.title}\n${r.text}`);
  const note = anomalyNote(orgId);
  if (note && !results.some((r) => r.tool === "list_denials" || r.tool === "lookup_decision")) {
    blocks.push(`Signals\n${note}`);
  }
  if (includeContext && results.length === 1 && results[0]?.tool === "org_summary") {
    blocks.push(`Live context\n${formatOrgContext(buildOrgContext(orgId))}`);
  }
  return blocks.join("\n\n");
}

function runKeywordPath(orgId: string, message: string, recent: ChatTurn[]): AbiAgentResult {
  const { query, reuseTools, scratch } = resolveFollowUp(message, recent);
  const picked = new Set<ToolName>([...pickTools(query), ...reuseTools]);

  if (!picked.size && reuseTools.length) {
    for (const t of reuseTools) picked.add(t);
  }

  if (!picked.size) {
    // Lightweight brain: if question looks like policy/quiet, force those tools
    const q = message.toLowerCase();
    if (/\b(policy|band|hitl|per payment|ask me)\b/.test(q)) picked.add("get_policy");
    if (/\bquiet\b/.test(q)) picked.add("quiet_hours_status");
  }

  if (!picked.size) {
    const legacy = answerQuestion(orgId, message);
    return {
      answer: `${legacy.answer}\n\n(${formatOrgContext(buildOrgContext(orgId))})`,
      goto: legacy.goto,
      toolsUsed: [],
      via: "legacy",
      scratchpad: scratch,
    };
  }

  const toolsUsed = [...picked];
  toolsUsed.sort((a, b) => {
    if (a === "draft_marketing_blurb") return -1;
    if (b === "draft_marketing_blurb") return 1;
    return 0;
  });
  const results: ToolResult[] = [];
  let externalAction: ExternalActionProposal | undefined;

  for (const t of toolsUsed) {
    if (t === "propose_external_action") {
      const inferred = inferExternalArgs(message);
      const draft = results.find((r) => r.tool === "draft_marketing_blurb");
      const result = runTool(orgId, t, {
        ...inferred,
        content:
          draft?.text?.replace(/^Draft \(not published[^)]*\):\s*/i, "").trim() ||
          inferred.content,
      });
      results.push(result);
      if (result.externalAction) externalAction = result.externalAction;
      continue;
    }
    if (t === "lookup_decision") {
      const dest = scratch.destinations?.[0];
      const m = message.match(/(?:to|for|at)\s+(\S+)/i);
      results.push(
        runTool(orgId, t, {
          query: dest || m?.[1] || message,
        }),
      );
      continue;
    }
    results.push(runTool(orgId, t));
  }

  const scratchpad = buildScratchpad(results, scratch);
  return {
    answer: composeAnswer(results, orgId, true),
    goto: preferGoto(results),
    toolsUsed,
    externalAction,
    via: "keywords",
    scratchpad,
  };
}

/**
 * Run the ABI agent. Pass recent chat turns for follow-up detection / LLM context.
 */
export async function runAbiAgent(
  orgId: string,
  message: string,
  recent: ChatTurn[] = [],
): Promise<AbiAgentResult> {
  try {
    const llm = await runLlmToolLoop(orgId, message, recent);
    if (llm && (llm.toolsUsed.length || llm.answer)) {
      const scratchpad = buildScratchpad(llm.results, lastScratchpad(recent));
      return {
        answer: llm.answer,
        goto: preferGoto(llm.results),
        toolsUsed: llm.toolsUsed,
        externalAction: llm.externalAction,
        via: "llm",
        scratchpad,
      };
    }
  } catch (err) {
    console.warn("[abi-agent] llm loop failed, using keywords:", (err as Error).message);
  }

  return runKeywordPath(orgId, message, recent);
}

export type { ChatTurn, ToolName, ExternalActionProposal, Scratchpad };
export { createExternalProposal, inferExternalArgs, resolveExternalProposal } from "./external-actions.js";
