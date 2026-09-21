/**
 * Synthesize guardian-facing recommendations from tool results + live context.
 * Deterministic — no invented numbers.
 */
import type { OrgContext } from "./context.js";
import type { ToolResult } from "./tools.js";

export function synthesizeAdvice(
  results: ToolResult[],
  ctx: OrgContext,
): { headline: string; bullets: string[] } | null {
  const bullets: string[] = [];

  if (ctx.pendingApprovals > 0) {
    bullets.push(
      `${ctx.pendingApprovals} payment${ctx.pendingApprovals === 1 ? "" : "s"} waiting in Approvals — clear those before tightening bands.`,
    );
  }
  if (ctx.booksOk === false) {
    bullets.push("Books show drift — open Overview / Ledger and reconcile before trusting balances.");
  } else if (ctx.booksOk === null) {
    bullets.push("Books could not be verified — reconcile before trusting balances.");
  }
  if (ctx.quiet.toLowerCase().includes("in quiet")) {
    bullets.push(`Quiet hours are active (${ctx.quiet}) — expect more holds until the window ends.`);
  }

  const rec = results.find((r) => r.tool === "recommend_next");
  if (rec?.data && Array.isArray(rec.data.bullets)) {
    for (const b of rec.data.bullets) {
      if (typeof b === "string" && !bullets.includes(b)) bullets.push(b);
    }
  }

  const denials = results.find((r) => r.tool === "list_denials");
  if (denials?.text && /blocked|denial/i.test(denials.text) && !/Nothing blocked/i.test(denials.text)) {
    bullets.push("Review recent denials — either the agent is probing outside policy or bands are too tight.");
  }

  const agents = results.find((r) => r.tool === "list_agents" || r.tool === "agent_detail");
  if (agents?.text && /frozen/i.test(agents.text)) {
    bullets.push("At least one agent is frozen — thaw only after you understand the freeze reason.");
  }

  const explain = results.find((r) => r.tool === "explain_decision");
  if (explain?.text && /\bDENY\b/.test(explain.text) && !bullets.some((b) => /denial/i.test(b))) {
    bullets.push("If denials look wrong, open Policy and adjust ask-me-above or the per-payment ceiling.");
  }

  const gov = results.find((r) => r.tool === "governance_status");
  if (gov?.text && /restricted/i.test(gov.text)) {
    bullets.push("Some guardians are restricted — confirm quorum can still clear parked payments.");
  }

  if (!bullets.length) return null;
  return {
    headline: "Suggested next",
    bullets: bullets.slice(0, 5),
  };
}

export function formatAdvice(advice: { headline: string; bullets: string[] }): string {
  return `${advice.headline}\n${advice.bullets.map((b) => `• ${b}`).join("\n")}`;
}
