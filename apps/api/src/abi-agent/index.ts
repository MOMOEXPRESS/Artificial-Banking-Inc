/**
 * ABI Agent loop — conversation-aware org survey + HITL external proposals.
 *
 * Prefers OpenAI tool-calling when OPENAI_API_KEY is set; falls back to keywords.
 * Read-only money tools only. External actions are proposals until guardian approves.
 */
import { answerQuestion } from "../insights.js";
import {
  inferExternalArgs,
  type ExternalActionProposal,
} from "./external-actions.js";
import { runLlmToolLoop } from "./llm-loop.js";
import { resolveFollowUp, type ChatTurn } from "./memory.js";
import { anomalyNote, pickTools, runTool, type ToolName, type ToolResult } from "./tools.js";

export type AbiAgentResult = {
  answer: string;
  goto?: string;
  toolsUsed: ToolName[];
  externalAction?: ExternalActionProposal;
  via?: "llm" | "keywords" | "legacy";
};

function preferGoto(results: ToolResult[]): string | undefined {
  const order = [
    "approvals",
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

function composeAnswer(results: ToolResult[], orgId: string): string {
  if (!results.length) return "I couldn't find a matching survey tool — try asking about agents, spend, or approvals.";
  const blocks = results.map((r) => `${r.title}\n${r.text}`);
  const note = anomalyNote(orgId);
  if (note && !results.some((r) => r.tool === "list_denials")) {
    blocks.push(`Signals\n${note}`);
  }
  return blocks.join("\n\n");
}

function runKeywordPath(orgId: string, message: string, recent: ChatTurn[]): AbiAgentResult {
  const { query, reuseTools } = resolveFollowUp(message, recent);
  const picked = new Set<ToolName>([...pickTools(query), ...reuseTools]);

  if (!picked.size && reuseTools.length) {
    for (const t of reuseTools) picked.add(t);
  }

  if (!picked.size) {
    const legacy = answerQuestion(orgId, message);
    return { answer: legacy.answer, goto: legacy.goto, toolsUsed: [], via: "legacy" };
  }

  const toolsUsed = [...picked];
  // Prefer draft before propose so MaltBook queue can reuse copy.
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
    results.push(runTool(orgId, t));
  }

  return {
    answer: composeAnswer(results, orgId),
    goto: preferGoto(results),
    toolsUsed,
    externalAction,
    via: "keywords",
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
      return {
        answer: llm.answer,
        goto: preferGoto(llm.results),
        toolsUsed: llm.toolsUsed,
        externalAction: llm.externalAction,
        via: "llm",
      };
    }
  } catch (err) {
    console.warn("[abi-agent] llm loop failed, using keywords:", (err as Error).message);
  }

  return runKeywordPath(orgId, message, recent);
}

export type { ChatTurn, ToolName, ExternalActionProposal };
export { createExternalProposal, inferExternalArgs, resolveExternalProposal } from "./external-actions.js";
