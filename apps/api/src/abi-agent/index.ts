/**
 * ABI Agent loop — conversation-aware org survey + marketing draft helper.
 *
 * Read-only tools only. Optional LLM polish happens in presentAnswer upstream.
 */
import { answerQuestion } from "../insights.js";
import { resolveFollowUp, type ChatTurn } from "./memory.js";
import { anomalyNote, pickTools, runTool, type ToolName, type ToolResult } from "./tools.js";

export type AbiAgentResult = {
  answer: string;
  goto?: string;
  toolsUsed: ToolName[];
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

/**
 * Run the ABI agent. Pass recent chat turns (excluding the just-appended user
 * message is fine; include it if already saved — follow-up detection uses it).
 */
export function runAbiAgent(
  orgId: string,
  message: string,
  recent: ChatTurn[] = [],
): AbiAgentResult {
  const { query, reuseTools } = resolveFollowUp(message, recent);
  const picked = new Set<ToolName>([...pickTools(query), ...reuseTools]);

  // Follow-ups that only reuse tools
  if (!picked.size && reuseTools.length) {
    for (const t of reuseTools) picked.add(t);
  }

  if (!picked.size) {
    const legacy = answerQuestion(orgId, message);
    return { answer: legacy.answer, goto: legacy.goto, toolsUsed: [] };
  }

  const toolsUsed = [...picked];
  const results = toolsUsed.map((t) => runTool(orgId, t));
  return {
    answer: composeAnswer(results, orgId),
    goto: preferGoto(results),
    toolsUsed,
  };
}

export type { ChatTurn, ToolName };
