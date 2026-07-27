/**
 * Optional OpenAI Chat Completions tool-calling loop for the ABI agent.
 * Falls back to keyword pickTools when no key / failure / empty tool use.
 */
import { buildOrgContext, formatOrgContext } from "./context.js";
import {
  lastScratchpad,
  resolveFollowUp,
  scratchpadSnippet,
  transcriptSnippet,
  type ChatTurn,
} from "./memory.js";
import {
  TOOL_NAMES,
  runTool,
  type ToolName,
  type ToolResult,
} from "./tools.js";
import { store } from "../store.js";
import { resolveAiEgress } from "./ai-settings.js";

const MAX_ROUNDS = 4;

const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  org_summary: "Org snapshot: headline health, highlights.",
  list_agents: "List agents on the roster with stipend balances.",
  agent_detail:
    "Deep dive on one agent: stipend, 24h spend, recent allow/deny/review, freeze history. Pass agentName or agentId.",
  pending_approvals: "Payments waiting for guardian HITL approval.",
  recent_spend: "Recent settled spend (24h + lifetime).",
  list_budgets: "Budget envelopes and available balances.",
  list_denials: "Policy denials / blocked payments.",
  top_vendors: "Top external payees by spend.",
  invoice_status: "Invoice revenue and outstanding.",
  escrow_status: "Peer escrow locked amounts.",
  books_health: "Ledger reconciliation / drift check.",
  burn_forecast: "Org burn rate and runway estimate.",
  get_policy: "Current judgment bands (ask-me-above, per-payment, daily), quiet hours, quorum.",
  quiet_hours_status: "Whether the org is in quiet hours right now and countdown.",
  lookup_decision: "Search recent allow/deny/review decisions by destination or rule.",
  explain_decision:
    "Explain a specific decision against live policy bands (HITL / ceiling / quiet). Prefer when asked why something was denied or reviewed.",
  governance_status: "Guardian seats, roles, max-approve limits, and approval quorum.",
  treasury_snapshot: "Org vault USDC + other holdings + budget envelopes.",
  compare_agents: "Compare agents by stipend and 24h spend.",
  recommend_next: "Prioritized next actions for the guardian (approvals, low stipends, quiet, drift).",
  remember_fact: "Save a guardian-taught org fact to durable memory.",
  recall_facts: "Recall previously saved org facts / notes.",
  draft_marketing_blurb: "Draft marketing copy from org facts (not published).",
};

type OpenAiToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type OpenAiMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
  name?: string;
};

function openaiTools() {
  return TOOL_NAMES.map((name) => {
    if (name === "lookup_decision" || name === "explain_decision") {
      return {
        type: "function" as const,
        function: {
          name,
          description: TOOL_DESCRIPTIONS[name],
          parameters: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "Destination, rule id, outcome, or intent fragment to search",
              },
              agentId: {
                type: "string",
                description: "Optional agent id to scope the search",
              },
            },
            required: name === "lookup_decision" ? ["query"] : [],
          },
        },
      };
    }
    if (name === "agent_detail") {
      return {
        type: "function" as const,
        function: {
          name,
          description: TOOL_DESCRIPTIONS[name],
          parameters: {
            type: "object",
            properties: {
              agentName: { type: "string", description: "Agent display name" },
              agentId: { type: "string", description: "Agent id if known" },
              query: { type: "string", description: "Fallback name fragment" },
            },
          },
        },
      };
    }
    if (name === "remember_fact") {
      return {
        type: "function" as const,
        function: {
          name,
          description: TOOL_DESCRIPTIONS[name],
          parameters: {
            type: "object",
            properties: {
              fact: { type: "string", description: "Org fact to save" },
            },
            required: ["fact"],
          },
        },
      };
    }
    if (name === "recall_facts") {
      return {
        type: "function" as const,
        function: {
          name,
          description: TOOL_DESCRIPTIONS[name],
          parameters: {
            type: "object",
            properties: {
              query: { type: "string", description: "Optional filter for remembered facts" },
            },
          },
        },
      };
    }
    return {
      type: "function" as const,
      function: {
        name,
        description: TOOL_DESCRIPTIONS[name],
        parameters: { type: "object", properties: {}, additionalProperties: false },
      },
    };
  });
}

function isToolName(n: string): n is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(n);
}

export type LlmLoopResult = {
  answer: string;
  toolsUsed: ToolName[];
  results: ToolResult[];
  via: "llm";
};

/**
 * Run up to MAX_ROUNDS of tool calls. Returns null if LLM unavailable or unused.
 */
export async function runLlmToolLoop(
  orgId: string,
  message: string,
  recent: ChatTurn[] = [],
): Promise<LlmLoopResult | null> {
  // Egress is a per-org decision now, not a platform default. `null` means
  // this organization has not agreed to send its financial data anywhere, so
  // the caller falls back to the keyword assistant.
  const egress = resolveAiEgress(orgId);
  if (!egress) return null;
  const { apiKey, baseUrl, model } = egress;
  const followed = resolveFollowUp(message, recent);
  const effectiveMessage = followed.query !== message ? followed.query : message;
  const history = transcriptSnippet(recent, 6);
  const scratch = scratchpadSnippet(lastScratchpad(recent));
  const ctx = formatOrgContext(buildOrgContext(orgId));
  let memories = "";
  try {
    const rows = store.listAbiMemories(orgId, 8);
    if (rows.length) {
      memories = `Remembered facts:\n${rows.map((r) => `- ${r.fact}`).join("\n")}`;
    }
  } catch {
    /* ignore */
  }
  let roster = "";
  try {
    const agents = store.listAgents(orgId).filter((a) => a.status !== "archived");
    if (agents.length) {
      roster = `Agent roster (use these exact names with agent_detail): ${agents.map((a) => a.name).join(", ")}`;
    }
  } catch {
    /* ignore */
  }
  const messages: OpenAiMessage[] = [
    {
      role: "system",
      content: [
        "You are ABI, Artificial Banking's guardian assistant — a reasoning brain over org facts.",
        "Use tools when you need detail. Live snapshot is already below — do not invent numbers.",
        "Never move money or approve payments — read-only tools only.",
        "Reason briefly: cite policy bands, quiet hours, or rule ids when explaining denials.",
        "When asked about a named agent, call agent_detail.",
        "When asked why a payment was denied/reviewed, call explain_decision (and get_policy if useful).",
        "For guardian seats / who can approve, call governance_status.",
        "For durable notes the guardian teaches you, call remember_fact; to list them call recall_facts.",
        "When asked what to do next, prefer recommend_next.",
        "You cannot post anywhere or sign up for anything. For social or web copy, call draft_marketing_blurb and hand the guardian text to post themselves.",
        "After tools return, write a concise plain-text reply for the guardian.",
        "",
        "ORG SNAPSHOT:",
        ctx,
        roster ? `\n${roster}` : "",
        scratch ? `\n${scratch}` : "",
        memories ? `\n${memories}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];
  if (history) {
    messages.push({
      role: "user",
      content: `Recent chat:\n${history}\n\nCurrent question: ${effectiveMessage}${
        followed.reuseTools.length
          ? `\n(Follow-up hint — prior tools: ${followed.reuseTools.join(", ")})`
          : ""
      }`,
    });
  } else {
    messages.push({ role: "user", content: effectiveMessage });
  }

  const toolsUsed: ToolName[] = [];
  const results: ToolResult[] = [];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages,
        tools: openaiTools(),
        tool_choice: "auto",
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`openai llm-loop HTTP ${res.status}: ${err.slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      choices?: {
        message?: {
          content?: string | null;
          tool_calls?: OpenAiToolCall[];
        };
        finish_reason?: string;
      }[];
    };
    const msg = data.choices?.[0]?.message;
    if (!msg) throw new Error("openai llm-loop empty message");

    const calls = msg.tool_calls ?? [];
    if (!calls.length) {
      const text = msg.content?.trim();
      if (!text && !results.length) return null;
      return {
        answer: text || results.map((r) => `${r.title}\n${r.text}`).join("\n\n"),
        toolsUsed,
        results,
        via: "llm",
      };
    }

    messages.push({
      role: "assistant",
      content: msg.content ?? null,
      tool_calls: calls,
    });

    for (const call of calls) {
      const name = call.function.name;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
      } catch {
        args = {};
      }
      if (!isToolName(name)) {
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: `Unknown tool: ${name}`,
        });
        continue;
      }
      if (!toolsUsed.includes(name)) toolsUsed.push(name);
      const result = runTool(orgId, name, args);
      results.push(result);
      const dataBlob = result.data ? `\nDATA:${JSON.stringify(result.data)}` : "";
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: `${result.title}\n${result.text}${dataBlob}`,
      });
    }
  }

  if (!results.length) return null;
  return {
    answer: results.map((r) => `${r.title}\n${r.text}`).join("\n\n"),
    toolsUsed,
    results,
    via: "llm",
  };
}
