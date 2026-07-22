/**
 * Lightweight intent classification for the keyword brain (no LLM required).
 */
export type AbiIntent =
  | "survey"
  | "agents"
  | "agent_detail"
  | "approvals"
  | "spend"
  | "budgets"
  | "denials"
  | "vendors"
  | "policy"
  | "quiet"
  | "treasury"
  | "books"
  | "burn"
  | "decision_why"
  | "governance"
  | "recommend"
  | "remember"
  | "recall"
  | "compare"
  | "help"
  | "unknown";

export function classifyIntent(message: string): AbiIntent {
  const q = message.toLowerCase().trim();

  if (/^(remember|note that|save that|don't forget)\b/.test(q) || /\bremember that\b/.test(q)) {
    return "remember";
  }
  if (/\b(what did i tell you|what do you remember|recall|your notes)\b/.test(q)) {
    return "recall";
  }
  if (
    /\b(what should i|recommend|next step|priorit|urgent|attention|focus)\b/.test(q) ||
    /^(what now|help me decide)\??$/.test(q)
  ) {
    return "recommend";
  }
  if (/\b(compare|vs\.?|versus|difference between)\b/.test(q)) return "compare";
  if (
    /\b(why|explain).{0,40}\b(deny|denied|blocked|refusal|refused|decision|payment)\b/.test(q) ||
    /\b(why was|why did|why that)\b/.test(q)
  ) {
    return "decision_why";
  }
  if (/\b(guardian|governance|who can approve|approver|quorum seats?)\b/.test(q)) {
    return "governance";
  }
  if (/\b(quiet|after hours|off hours)\b/.test(q)) return "quiet";
  if (/\b(policy|band|bands|hitl|ask me|per payment|per tx|daily max|threshold|ceiling)\b/.test(q)) {
    return "policy";
  }
  if (/\b(treasury|vault|deposit|withdraw|holding|btc|eth|usdc balance)\b/.test(q)) return "treasury";
  if (/\b(burn|runway)\b/.test(q)) return "burn";
  if (/\b(reconcile|books|drift|ledger clean)\b/.test(q)) return "books";
  if (/\b(approval|pending|waiting|inbox|parked)\b/.test(q)) return "approvals";
  if (/\b(deny|denied|denial|blocked|refuse)\b/.test(q)) return "denials";
  if (/\b(vendor|counterparty|who did we pay|where did money)\b/.test(q)) return "vendors";
  if (/\b(budget|envelope|department)\b/.test(q)) return "budgets";
  if (/\b(spend|spent|cost|payment)\b/.test(q)) return "spend";
  if (
    /\b(about|detail|profile|how's|how is|tell me about|check on|inspect)\b/.test(q) &&
    /\b(agent|researcher|writer|stipend)\b/.test(q)
  ) {
    return "agent_detail";
  }
  if (/\b(agent|roster|stipend|researcher|writer)\b/.test(q)) return "agents";
  if (
    /\b(summary|overview|status|how are we|health|snapshot|look around)\b/.test(q) ||
    /^(hi|hello|hey)\b/.test(q)
  ) {
    return "survey";
  }
  if (/\b(help|what can you)\b/.test(q)) return "help";
  return "unknown";
}
