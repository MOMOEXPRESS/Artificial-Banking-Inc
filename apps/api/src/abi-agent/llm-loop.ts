/**
 * Optional OpenAI Chat Completions tool-calling loop for the ABI agent.
 * Falls back to keyword pickTools when no key / failure / empty tool use.
 */
import { buildOrgContext, formatOrgContext } from "./context.js";
import { lastScratchpad, scratchpadSnippet, transcriptSnippet, type ChatTurn } from "./memory.js";
import {
  TOOL_NAMES,
  runTool,
  type ToolName,
  type ToolResult,
} from "./tools.js";
import type { ExternalActionProposal } from "./external-actions.js";

const MAX_ROUNDS = 4;

const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  org_summary: "Org snapshot: headline health, highlights.",
  list_agents: "List agents on the roster with stipend balances.",
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
  draft_marketing_blurb: "Draft marketing copy from org facts (not published).",
  propose_external_action:
    "Queue a HITL proposal to post/signup/comment on an external site (e.g. MaltBook). Does NOT execute — guardian must approve.",
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
    if (name === "propose_external_action") {
      return {
        type: "function" as const,
        function: {
          name,
          description: TOOL_DESCRIPTIONS[name],
          parameters: {
            type: "object",
            properties: {
              platform: {
                type: "string",
                enum: ["maltbook", "linkedin", "x", "web"],
                description: "Target platform",
              },
              action: {
                type: "string",
                enum: ["post", "signup", "comment"],
                description: "What to propose",
              },
              content: {
                type: "string",
                description: "Draft post text or signup notes",
              },
            },
            required: ["platform", "action", "content"],
          },
        },
      };
    }
    if (name === "lookup_decision") {
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
                description: "Destination, rule id, or outcome fragment to search",
              },
            },
            required: ["query"],
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
  externalAction?: ExternalActionProposal;
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
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey || process.env.ABI_CHAT_LLM === "0") return null;

  const model = process.env.ABI_OPENAI_MODEL?.trim() || "gpt-4o-mini";
  const history = transcriptSnippet(recent, 6);
  const scratch = scratchpadSnippet(lastScratchpad(recent));
  const ctx = formatOrgContext(buildOrgContext(orgId));
  const messages: OpenAiMessage[] = [
    {
      role: "system",
      content: [
        "You are ABI, Artificial Banking's guardian assistant — a reasoning brain over org facts.",
        "Use tools when you need detail. Live snapshot is already below — do not invent numbers.",
        "Never move money or approve payments — read-only tools only.",
        "Reason briefly: cite policy bands, quiet hours, or rule ids when explaining denials.",
        "For MaltBook / LinkedIn / X / web posts or signups, call propose_external_action — do not claim you posted.",
        "After tools return, write a concise plain-text reply for the guardian.",
        "",
        "ORG SNAPSHOT:",
        ctx,
        scratch ? `\n${scratch}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];
  if (history) {
    messages.push({
      role: "user",
      content: `Recent chat:\n${history}\n\nCurrent question: ${message}`,
    });
  } else {
    messages.push({ role: "user", content: message });
  }

  const toolsUsed: ToolName[] = [];
  const results: ToolResult[] = [];
  let externalAction: ExternalActionProposal | undefined;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
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
        externalAction,
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
      if (result.externalAction) externalAction = result.externalAction;
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
    externalAction,
    via: "llm",
  };
}
