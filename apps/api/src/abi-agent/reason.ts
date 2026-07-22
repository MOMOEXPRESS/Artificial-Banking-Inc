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
  if (!ctx.booksOk) {
    bullets.push("Books show drift — open Overview / Ledger and reconcile before trusting balances.");
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

  const agents = results.find((r) => r.tool === "list_agents");
  if (agents?.text && /frozen/i.test(agents.text)) {
    bullets.push("At least one agent is frozen — thaw only after you understand the freeze reason.");
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
