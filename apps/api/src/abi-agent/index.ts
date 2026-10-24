/**
 * ABI Agent loop — intent → plan → entities → tools → synthesize advice.
 *
 * Prefers OpenAI tool-calling when OPENAI_API_KEY is set; falls back to keywords.
 * Read-only money tools only. External actions are proposals until guardian approves.
 */
import { answerQuestion } from "../insights.js";
import { buildOrgContext, formatOrgContext } from "./context.js";
import { parseMemoryCommand, type MemoryCommand } from "./memory-commands.js";
import { store } from "../store.js";
import { bindEntities, wantsAgentDetail } from "./entities.js";
import { classifyIntent } from "./intent.js";
import { runLlmToolLoop } from "./llm-loop.js";
import {
  buildScratchpad,
  lastScratchpad,
  resolveFollowUp,
  type ChatTurn,
  type Scratchpad,
} from "./memory.js";
import { planTools } from "./planner.js";
import { formatAdvice, synthesizeAdvice } from "./reason.js";
import { anomalyNote, pickTools, runTool, type ToolName, type ToolResult } from "./tools.js";

export type AbiAgentResult = {
  answer: string;
  goto?: string;
  toolsUsed: ToolName[];
  via?: "llm" | "keywords" | "legacy";
  scratchpad?: Scratchpad;
  intent?: string;
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

function composeAnswer(results: ToolResult[], orgId: string): string {
  if (!results.length) {
    return "I couldn't find a matching survey tool — try asking about agents, spend, policy bands, quiet hours, or what I should do next.";
  }
  const blocks = results.map((r) => `${r.title}\n${r.text}`);
  const note = anomalyNote(orgId);
  if (
    note &&
    !results.some(
      (r) =>
        r.tool === "list_denials" || r.tool === "lookup_decision" || r.tool === "explain_decision",
    )
  ) {
    blocks.push(`Signals\n${note}`);
  }
  const ctx = buildOrgContext(orgId);
  const advice = synthesizeAdvice(results, ctx);
  if (advice && !results.some((r) => r.tool === "recommend_next")) {
    blocks.push(formatAdvice(advice));
  }
  return blocks.join("\n\n");
}

/** Notes that share meaningful words with the question (max 3). */
function relevantNotes(orgId: string, message: string): string[] {
  try {
    if (!store.countAbiMemories(orgId)) return [];
    return store.searchAbiMemories(orgId, message, 3).map((m) => m.fact);
  } catch {
    return [];
  }
}

function notesBlock(notes: string[]): string | null {
  return notes.length ? `From your saved notes\n${notes.map((n) => `• ${n}`).join("\n")}` : null;
}

/** Last few things the guardian asked, from durable chat history. */
function recentTopics(recent: ChatTurn[], max = 3): string[] {
  return recent
    .filter((t) => t.role === "user" && !parseMemoryCommand(t.body))
    .slice(-max)
    .map((t) => (t.body.length > 90 ? `${t.body.slice(0, 87)}…` : t.body));
}

/**
 * Remember / recall / forget are deterministic — they never depend on a model
 * deciding to call a tool, and they run the same with or without an LLM key.
 */
function runMemoryCommand(orgId: string, cmd: MemoryCommand, recent: ChatTurn[]): AbiAgentResult {
  const scratch = lastScratchpad(recent);
  if (cmd.kind === "remember") {
    const r = runTool(orgId, "remember_fact", { fact: cmd.fact });
    const blocks = [`${r.title}\n${r.text}`];
    // Tie the note to live state when it names an agent on the roster.
    if (cmd.fact) {
      const lower = cmd.fact.toLowerCase();
      const ctx = buildOrgContext(orgId);
      const hit = ctx.agents?.find((a) => lower.includes(a.name.toLowerCase()));
      if (hit) {
        blocks.push(
          `Context\n${hit.name} is ${hit.status} with a $${hit.stipendUsdc} stipend — I'll bring this note up when you ask about ${hit.name}.`,
        );
      }
    }
    return {
      answer: blocks.join("\n\n"),
      goto: "chat",
      toolsUsed: ["remember_fact"],
      via: "keywords",
      scratchpad: buildScratchpad([r], scratch),
      intent: "remember",
    };
  }
  if (cmd.kind === "forget") {
    const r = runTool(orgId, "forget_fact", { target: cmd.target, all: cmd.all });
    return {
      answer: `${r.title}\n${r.text}`,
      goto: "chat",
      toolsUsed: ["forget_fact"],
      via: "keywords",
      scratchpad: buildScratchpad([r], scratch),
      intent: "forget",
    };
  }
  const r = runTool(orgId, "recall_facts", { query: cmd.query });
  const blocks = [`${r.title}\n${r.text}`];
  if (!cmd.query) {
    const topics = recentTopics(recent);
    if (topics.length) {
      blocks.push(`Recent conversation\n${topics.map((t) => `• You asked: ${t}`).join("\n")}`);
    }
    blocks.push(`Where things stand now\n${formatOrgContext(buildOrgContext(orgId))}`);
  }
  return {
    answer: blocks.join("\n\n"),
    goto: "chat",
    toolsUsed: ["recall_facts"],
    via: "keywords",
    scratchpad: buildScratchpad([r], scratch),
    intent: "recall",
  };
}

function runKeywordPath(orgId: string, message: string, recent: ChatTurn[]): AbiAgentResult {
  const intent = classifyIntent(message);
  const { query, reuseTools, scratch } = resolveFollowUp(message, recent);
  const entities = bindEntities(orgId, query);
  // Merge scratch entities when follow-up is pronoun-heavy
  if (!entities.agentIds.length && scratch.agentIds?.length) {
    entities.agentIds = scratch.agentIds;
    entities.agentNames = scratch.agentNames ?? [];
  }
  if (!entities.destinations.length && scratch.destinations?.length) {
    entities.destinations = scratch.destinations;
  }

  const planned = planTools(intent, query);
  const picked = new Set<ToolName>([...planned, ...pickTools(query), ...reuseTools]);

  if (wantsAgentDetail(query, entities) || intent === "agent_detail") {
    picked.add("agent_detail");
    // Prefer detail over full roster when a name is bound
    if (entities.agentIds.length) picked.delete("list_agents");
  }

  if (!picked.size && reuseTools.length) {
    for (const t of reuseTools) picked.add(t);
  }

  if (!picked.size) {
    const legacy = answerQuestion(orgId, message);
    const ctx = buildOrgContext(orgId);
    const advice = synthesizeAdvice([], ctx);
    return {
      answer: [
        legacy.answer,
        notesBlock(relevantNotes(orgId, message)),
        advice ? formatAdvice(advice) : null,
        `(${formatOrgContext(ctx)})`,
      ]
        .filter(Boolean)
        .join("\n\n"),
      goto: legacy.goto,
      toolsUsed: [],
      via: "legacy",
      scratchpad: scratch,
      intent,
    };
  }

  const toolsUsed = [...picked];
  // Prefer remember before other tools when teaching; agent_detail before compare
  toolsUsed.sort((a, b) => {
    const rank = (t: ToolName) =>
      t === "remember_fact"
        ? 0
        : t === "draft_marketing_blurb"
          ? 1
          : t === "agent_detail"
            ? 2
            : t === "explain_decision"
              ? 3
              : 10;
    return rank(a) - rank(b);
  });
  const results: ToolResult[] = [];
  for (const t of toolsUsed) {
    if (t === "lookup_decision" || t === "explain_decision") {
      const dest = entities.destinations[0] || scratch.destinations?.[0];
      const m = message.match(/(?:to|for|at)\s+(\S+)/i);
      results.push(
        runTool(orgId, t, {
          query: dest || m?.[1] || message,
          agentId: entities.agentIds[0],
        }),
      );
      continue;
    }
    if (t === "agent_detail") {
      results.push(
        runTool(orgId, t, {
          agentId: entities.agentIds[0],
          agentName: entities.agentNames[0],
          query: entities.agentNames[0] || message,
        }),
      );
      continue;
    }
    if (t === "remember_fact") {
      results.push(runTool(orgId, t, { fact: message, message }));
      continue;
    }
    if (t === "recall_facts") {
      const cmd = parseMemoryCommand(message);
      results.push(runTool(orgId, t, { query: cmd?.kind === "recall" ? cmd.query : "" }));
      continue;
    }
    if (t === "forget_fact") {
      const cmd = parseMemoryCommand(message);
      if (cmd?.kind !== "forget") continue;
      results.push(runTool(orgId, t, { target: cmd.target, all: cmd.all }));
      continue;
    }
    results.push(runTool(orgId, t));
  }

  // Auto-attach recall when surveying if memories exist
  if ((intent === "survey" || intent === "help") && !toolsUsed.includes("recall_facts")) {
    const mem = runTool(orgId, "recall_facts", {});
    if (!/No saved notes/i.test(mem.text)) {
      results.push(mem);
      toolsUsed.push("recall_facts");
    }
  }

  // Bring relevant saved notes into ordinary answers so taught facts are used,
  // not just listed back on request.
  const notes = toolsUsed.includes("recall_facts") ? [] : relevantNotes(orgId, query);
  const scratchpad = buildScratchpad(results, {
    ...scratch,
    agentIds: entities.agentIds.length ? entities.agentIds : scratch.agentIds,
    agentNames: entities.agentNames.length ? entities.agentNames : scratch.agentNames,
    destinations: entities.destinations.length ? entities.destinations : scratch.destinations,
  });
  return {
    answer: [composeAnswer(results, orgId), notesBlock(notes)].filter(Boolean).join("\n\n"),
    goto: preferGoto(results),
    toolsUsed,
    via: "keywords",
    scratchpad,
    intent,
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
  const memoryCmd = parseMemoryCommand(message);
  if (memoryCmd) return runMemoryCommand(orgId, memoryCmd, recent);
  try {
    const llm = await runLlmToolLoop(orgId, message, recent);
    if (llm && (llm.toolsUsed.length || llm.answer)) {
      const scratchpad = buildScratchpad(llm.results, lastScratchpad(recent));
      const ctx = buildOrgContext(orgId);
      const advice = synthesizeAdvice(llm.results, ctx);
      const answer =
        advice && !llm.toolsUsed.includes("recommend_next")
          ? `${llm.answer}\n\n${formatAdvice(advice)}`
          : llm.answer;
      return {
        answer,
        goto: preferGoto(llm.results),
        toolsUsed: llm.toolsUsed,
        via: "llm",
        scratchpad,
        intent: classifyIntent(message),
      };
    }
  } catch (err) {
    console.warn("[abi-agent] llm loop failed, using keywords:", (err as Error).message);
  }

  return runKeywordPath(orgId, message, recent);
}

export { runMemoryCommand };
export type { ChatTurn, ToolName, Scratchpad };
