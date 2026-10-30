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
import {
  detectActionRequest,
  normalizeMessage,
  outOfScopeTopic,
  parseReference,
  type ActionRequest,
  type Normalized,
} from "./language.js";
import { suggestFollowUps } from "./suggestions.js";

export type AbiAgentResult = {
  answer: string;
  goto?: string;
  toolsUsed: ToolName[];
  via?: "llm" | "keywords" | "legacy";
  scratchpad?: Scratchpad;
  intent?: string;
  /** Quick-reply chips for the next turn (questions ABI can answer). */
  suggestions?: string[];
};

export type AbiAgentOptions = {
  /** Caller's guardian role — shapes "who can do this" guidance, never permissions. */
  role?: "owner" | "approver" | "viewer";
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
  const wantOutcome = /\b(blocked|denied|denial|refused)\b/.test(message)
    ? "deny"
    : /\b(waiting|pending|review|reviewed|parked)\b/.test(message)
      ? "review"
      : undefined;
  const entities = bindEntities(orgId, query);
  /** Agents named in *this* message (before borrowing last turn's). */
  const namedNow = [...entities.agentIds];
  // Merge scratch entities when follow-up is pronoun-heavy
  if (!entities.agentIds.length && scratch.agentIds?.length) {
    entities.agentIds = scratch.agentIds;
    entities.agentNames = scratch.agentNames ?? [];
  }
  if (!entities.destinations.length && scratch.destinations?.length) {
    entities.destinations = scratch.destinations;
  }

  const planned = planTools(intent, query);
  let loose = pickTools(query);
  // pickTools answers any short message with a status survey. That is right
  // for "hi" but wrong for "and the writer?" (already routed) or "blorp"
  // (not understood — say so instead of reciting numbers).
  const surveyFallback =
    loose.length === 2 &&
    loose.includes("org_summary") &&
    loose.includes("pending_approvals") &&
    !/\b(summary|overview|status|approvals?|pending|waiting)\b/.test(query);
  if (surveyFallback) {
    const greeting = /\b(hi|hello|hey|help|abi|survey|look around|what can)\b/.test(query);
    if (planned.length || reuseTools.length || entities.agentIds.length || !greeting) loose = [];
  }
  const picked = new Set<ToolName>([...planned, ...loose, ...reuseTools]);

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
    if (/^I can answer from your own data/.test(legacy.answer)) {
      return {
        answer: [
          `I'm not sure what you're asking${message.length <= 60 ? ` with “${message}”` : ""}, so I won't guess at numbers.`,
          "I can answer from your org's live data: agents and their spend, balances and budgets, what's waiting on you, recent payments and why one was blocked, policy bands and quiet hours, notifications, and what we talked about before. Try one of the suggestions below, or rephrase.",
          notesBlock(relevantNotes(orgId, message)),
        ]
          .filter(Boolean)
          .join("\n\n"),
        goto: "chat",
        toolsUsed: [],
        via: "keywords",
        scratchpad: scratch,
        intent: "unknown",
      };
    }
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
          outcome: wantOutcome,
        }),
      );
      continue;
    }
    if (t === "recent_payments") {
      results.push(
        runTool(orgId, t, {
          agentId: namedNow.length === 1 ? namedNow[0] : undefined,
          outcome: wantOutcome === "deny" ? "deny" : undefined,
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

/** What each refused action maps to in the console, and who can do it there. */
function actionGuard(
  orgId: string,
  action: ActionRequest,
  recent: ChatTurn[],
  opts: AbiAgentOptions,
): AbiAgentResult {
  const ctx = buildOrgContext(orgId);
  const scratch = lastScratchpad(recent);
  const results: ToolResult[] = [];
  let how = "";
  let goto = "chat";
  switch (action.kind) {
    case "approve":
    case "deny":
      results.push(runTool(orgId, "pending_approvals"));
      how = ctx.pendingApprovals
        ? "Use the Approve / Deny buttons on the payment card at the top of this chat, or open Approvals. Each vote is yours and is recorded against your seat."
        : "There's nothing waiting for a decision right now.";
      goto = "approvals";
      break;
    case "pay":
      how =
        "Payments are made by your agents and checked against policy; guardians fund agents and budgets from Treasury, where you confirm each transfer yourself.";
      goto = "treasury";
      break;
    case "policy":
      results.push(runTool(orgId, "get_policy"));
      how =
        opts.role === "owner"
          ? "As the owner you can change bands and quiet hours in Policy — the change is versioned and you can restore an earlier one."
          : "Policy changes are owner-only; ask an owner, or open Policy to see the current bands.";
      goto = "policy";
      break;
    case "freeze":
    case "agent_admin":
      results.push(runTool(orgId, "list_agents"));
      how =
        "Open the agent's page in the console to freeze, thaw, rename or rotate its key — you confirm the change there.";
      goto = "agents";
      break;
    case "notifications":
      how = "Use “Mark all read” under the bell — I only read notifications, I never change them.";
      goto = "overview";
      break;
  }
  const blocks = [
    `I can't ${action.what} from chat — the ABI Assistant is read-only, so nothing moves or changes unless you do it yourself in the console.`,
    how,
    ...results.map((r) => `${r.title}\n${r.text}`),
  ].filter(Boolean);
  return {
    answer: blocks.join("\n\n"),
    goto,
    toolsUsed: results.map((r) => r.tool),
    via: "keywords",
    scratchpad: buildScratchpad(results, scratch),
    intent: "action_request",
  };
}

function outOfScope(orgId: string, topic: string, recent: ChatTurn[]): AbiAgentResult {
  return {
    answer: `I don't have data on ${topic} — ABI only sees your organization's own agents, balances, payments, policy and notifications, so any figure I gave you would be made up.\n\nWhere things stand now\n${formatOrgContext(buildOrgContext(orgId))}`,
    goto: "chat",
    toolsUsed: [],
    via: "keywords",
    scratchpad: lastScratchpad(recent),
    intent: "out_of_scope",
  };
}

/**
 * "explain the second one" / "why was the last one blocked" / "that payment":
 * resolve against the list shown last turn, else against the live trail.
 */
function resolveReferenceTurn(
  orgId: string,
  text: string,
  recent: ChatTurn[],
): AbiAgentResult | null {
  const ref = parseReference(text);
  if (ref === null) return null;
  const scratch = lastScratchpad(recent);
  const outcome = /\b(blocked|denied|denial)\b/.test(text)
    ? "deny"
    : /\b(waiting|pending|review)\b/.test(text)
      ? "review"
      : undefined;
  // A numbered agent list → "the second one" is an agent.
  if (
    typeof ref === "number" &&
    scratch.lastTopic === "agents" &&
    (scratch.agentNames?.length ?? 0) > 1 &&
    !scratch.decisionIds?.length
  ) {
    const name = scratch.agentNames![ref - 1];
    if (!name) return null;
    const r = runTool(orgId, "agent_detail", {
      agentId: scratch.agentIds?.[ref - 1],
      agentName: name,
    });
    return {
      answer: `${r.title}\n${r.text}`,
      goto: r.goto,
      toolsUsed: ["agent_detail"],
      via: "keywords",
      scratchpad: buildScratchpad([r], scratch),
      intent: "agent_detail",
    };
  }
  const ids = scratch.decisionIds ?? [];
  let intentId: string | undefined;
  if (typeof ref === "number") {
    intentId = ids[ref - 1];
    if (!intentId) {
      if (!ids.length) return null;
      return {
        answer: `The last list I showed had ${ids.length} item${ids.length === 1 ? "" : "s"}, so there's no number ${ref}. Say “show recent payments” to refresh it.`,
        goto: "payments",
        toolsUsed: [],
        via: "keywords",
        scratchpad: scratch,
        intent: "decision_why",
      };
    }
  } else if (!outcome && ids.length && scratch.lastTopic === "payments") {
    intentId = ids[0];
  }
  const r = runTool(orgId, "explain_decision", {
    intentId,
    outcome,
    // "why was the last one blocked" is org-wide; only scope to the agent in
    // focus when the guardian didn't name an outcome.
    agentId:
      !intentId && !outcome && scratch.agentIds?.length === 1 ? scratch.agentIds[0] : undefined,
  });
  return {
    answer: `${r.title}\n${r.text}`,
    goto: r.goto,
    toolsUsed: ["explain_decision"],
    via: "keywords",
    scratchpad: buildScratchpad([r], { ...scratch, decisionIds: scratch.decisionIds }),
    intent: "decision_why",
  };
}

/** Saved notes like "I prefer short answers" change how replies are shaped. */
function prefersBrief(orgId: string): boolean {
  try {
    return store
      .listAbiMemories(orgId, 50)
      .some((m) =>
        /\b(prefer|like|want|keep)\b.{0,30}\b(short|brief|concise|terse|quick)\b.{0,12}\b(answers?|replies|responses?)?/i.test(
          m.fact,
        ),
      );
  } catch {
    return false;
  }
}

function brief(answer: string): string {
  // Keep the substance; drop the advisory tails and context echoes.
  return answer
    .split("\n\n")
    .filter((b) => !/^(Suggested next|Signals|Where things stand now|\(Vault )/.test(b))
    .join("\n\n");
}

function finish(
  orgId: string,
  res: AbiAgentResult,
  norm: Normalized | null,
  recent: ChatTurn[],
): AbiAgentResult {
  let answer = res.answer;
  if (res.intent !== "remember" && res.intent !== "forget" && prefersBrief(orgId)) {
    answer = brief(answer);
  }
  // Don't repeat the same "Suggested next" block turn after turn.
  const prevAssistant = [...recent].reverse().find((t) => t.role === "assistant")?.body ?? "";
  const blocks = answer.split("\n\n");
  const repeated = blocks.filter((b) => /^Suggested next\n/.test(b) && prevAssistant.includes(b));
  if (repeated.length && blocks.length > repeated.length) {
    answer = blocks.filter((b) => !repeated.includes(b)).join("\n\n");
  }
  if (norm?.corrections.length) {
    const fixes = norm.corrections.map((c) => `“${c.from}” as “${c.to}”`).join(", ");
    answer = `(Reading ${fixes}.)\n\n${answer}`;
  }
  const ctx = buildOrgContext(orgId);
  const suggestions = suggestFollowUps({
    intent: res.intent,
    toolsUsed: res.toolsUsed,
    ctx,
    scratch: res.scratchpad ?? lastScratchpad(recent),
  });
  return { ...res, answer, suggestions };
}

/**
 * Run the ABI agent. Pass recent chat turns for follow-up detection / LLM context.
 *
 * Order matters: memory commands, then refusals (the assistant is read-only and
 * says so before any model sees the request), then out-of-scope honesty, then
 * references to the last list, then the optional LLM, then the keyword brain —
 * which reads the normalized text so typos and casual phrasing still route.
 */
export async function runAbiAgent(
  orgId: string,
  message: string,
  recent: ChatTurn[] = [],
  opts: AbiAgentOptions = {},
): Promise<AbiAgentResult> {
  const memoryCmd = parseMemoryCommand(message);
  if (memoryCmd) return finish(orgId, runMemoryCommand(orgId, memoryCmd, recent), null, recent);

  let names: string[] = [];
  try {
    names = store
      .listAgents(orgId)
      .filter((a) => a.status !== "archived")
      .map((a) => a.name);
  } catch {
    names = [];
  }
  const norm = normalizeMessage(message, names);
  const text = norm.text || message.toLowerCase();

  const action = detectActionRequest(norm.light) ?? detectActionRequest(text);
  if (action) return finish(orgId, actionGuard(orgId, action, recent, opts), norm, recent);

  const oos = outOfScopeTopic(text);
  if (
    oos &&
    classifyIntent(text) === "unknown" &&
    !pickTools(text).some((t) => t !== "org_summary" && t !== "pending_approvals")
  ) {
    return finish(orgId, outOfScope(orgId, oos, recent), norm, recent);
  }

  const referred = resolveReferenceTurn(orgId, text, recent);
  if (referred) return finish(orgId, referred, norm, recent);

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
      return finish(
        orgId,
        {
          answer,
          goto: preferGoto(llm.results),
          toolsUsed: llm.toolsUsed,
          via: "llm",
          scratchpad,
          intent: classifyIntent(text),
        },
        null,
        recent,
      );
    }
  } catch (err) {
    console.warn("[abi-agent] llm loop failed, using keywords:", (err as Error).message);
  }

  return finish(orgId, runKeywordPath(orgId, text, recent), norm, recent);
}

export { runMemoryCommand };
export type { ChatTurn, ToolName, Scratchpad };
