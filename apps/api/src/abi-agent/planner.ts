/**
 * Map classified intents → tool plans for the keyword brain.
 */
import type { AbiIntent } from "./intent.js";
import type { ToolName } from "./tools.js";

export function planTools(intent: AbiIntent, message: string): ToolName[] {
  switch (intent) {
    case "survey":
      return ["org_summary", "pending_approvals", "quiet_hours_status"];
    case "agents":
      return ["list_agents"];
    case "agent_detail":
      return ["agent_detail"];
    case "approvals":
      return ["pending_approvals"];
    case "spend":
      return ["recent_spend"];
    case "budgets":
      return ["list_budgets"];
    case "denials":
      return ["list_denials"];
    case "vendors":
      return ["top_vendors"];
    case "policy":
      return ["get_policy"];
    case "quiet":
      return ["quiet_hours_status"];
    case "treasury":
      return ["treasury_snapshot"];
    case "books":
      return ["books_health"];
    case "burn":
      return ["burn_forecast"];
    case "decision_why":
      return ["explain_decision", "lookup_decision", "get_policy"];
    case "governance":
      return ["governance_status", "get_policy"];
    case "recommend":
      return ["recommend_next"];
    case "remember":
      return ["remember_fact"];
    case "recall":
      return ["recall_facts"];
    case "compare":
      return ["list_agents", "compare_agents"];
    case "help":
      return ["org_summary", "recommend_next"];
    case "unknown":
    default: {
      // Soft fallbacks from loose keywords already handled; leave empty for pickTools.
      void message;
      return [];
    }
  }
}
