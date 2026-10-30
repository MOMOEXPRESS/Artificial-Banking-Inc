/**
 * Workflow engine — runs a Mission step by step against production flows.
 *
 * - Every guardian write (the run record) goes through the console's
 *   authenticated client, so it carries the session, CSRF and org headers.
 * - A step that needs a human parks the run until the approval resolves.
 * - Runs are persisted as they go, so a run parked on an approval can be
 *   resumed after a page reload (`resume`).
 */
import * as A from "../flows/agent";
import * as G from "../flows/guardian";
import {
  newRunState,
  type Mission,
  type RunState,
  type RunStep,
  type StepResult,
  type WorkflowCtx,
} from "./types";

export type RunRepeat = "once" | "repeat3";

export const RUN_REPEATS: { id: RunRepeat; label: string; detail: string }[] = [
  { id: "once", label: "Run once", detail: "Single run, full timeline." },
  {
    id: "repeat3",
    label: "Repeat ×3",
    detail: "Three back-to-back runs (fresh idempotency keys each time).",
  },
];

/**
 * Expand a selection into the queue of missions to run. A chain mission (the
 * smoke chain) expands into its members; repeat multiplies the queue.
 */
export function planRun(
  mission: Mission,
  repeat: RunRepeat,
  lookup: (id: string) => Mission | undefined,
): Mission[] {
  const one = mission.chain?.length
    ? mission.chain.map(lookup).filter((m): m is Mission => !!m)
    : [mission];
  return repeat === "repeat3" ? [...one, ...one, ...one] : one;
}

export const newRunId = () =>
  `run_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

async function persistRun(
  ctx: WorkflowCtx,
  mission: Mission,
  steps: RunStep[],
  state: RunState,
  status: "running" | "complete" | "failed" | "cancelled",
  startedAt: string,
  deliverable?: string,
): Promise<void> {
  try {
    await G.saveRun(ctx.guardian, ctx.runId, {
      missionId: mission.id,
      title: mission.title,
      agentId: ctx.agentId,
      agentName: ctx.agentName,
      status,
      startedAt,
      finishedAt: status === "running" ? undefined : new Date().toISOString(),
      costUsdc: state.spentUsd.toFixed(6),
      steps: steps.map((s) => ({
        id: s.id,
        title: s.title,
        detail: s.detail,
        status: s.status,
        summary: s.summary,
        // A parked step's output already carries `approvalId`; resume reads it back.
        output: s.output,
      })),
      deliverableMd: deliverable,
    });
  } catch {
    /* the run record is a convenience — never break the mission over it */
  }
}

/** The approval a parked step is waiting on (from the step or its saved output). */
export function approvalIdOf(step: { approvalId?: string; output?: string }): string | undefined {
  if (step.approvalId) return step.approvalId;
  if (!step.output) return undefined;
  try {
    const parsed = JSON.parse(step.output) as { approvalId?: unknown };
    return typeof parsed.approvalId === "string" ? parsed.approvalId : undefined;
  } catch {
    return /"approvalId":\s*"([^"]+)"/.exec(step.output)?.[1];
  }
}

export type ResumePoint = {
  /** Steps as last persisted. */
  steps: RunStep[];
  startedAt: string;
  costUsdc?: string;
};

export async function runMission(
  mission: Mission,
  ctx: WorkflowCtx,
  resume?: ResumePoint,
): Promise<void> {
  const defs = mission.build(ctx);
  const state = newRunState();
  let steps: RunStep[];
  let startAt = 0;
  const startedAt = resume?.startedAt ?? new Date().toISOString();
  if (resume) {
    // Re-attach to the persisted run: keep finished steps, pick up at the
    // parked one. Steps the saved record does not know about start pending.
    steps = defs.map((d, i) => {
      const saved = resume.steps[i];
      return saved && saved.id === d.id
        ? { ...saved, approvalId: approvalIdOf(saved) }
        : { id: d.id, title: d.title, detail: d.detail, status: "pending" };
    });
    state.spentUsd = Number(resume.costUsdc ?? 0) || 0;
    const parked = steps.findIndex((s) => s.status === "blocked" || s.status === "running");
    startAt = parked >= 0 ? parked : steps.findIndex((s) => s.status === "pending");
    if (startAt < 0) startAt = steps.length;
  } else {
    steps = defs.map((d) => ({ id: d.id, title: d.title, detail: d.detail, status: "pending" }));
  }
  ctx.emit([...steps]);
  void persistRun(ctx, mission, steps, state, "running", startedAt);

  for (let i = startAt; i < defs.length; i++) {
    if (ctx.cancelled()) {
      for (let j = i; j < steps.length; j++) {
        if (steps[j].status !== "done") steps[j].status = "skipped";
      }
      ctx.emit([...steps]);
      await persistRun(ctx, mission, steps, state, "cancelled", startedAt);
      return;
    }

    let result: StepResult;
    const resumedApproval =
      resume && i === startAt && steps[i].status === "blocked" ? approvalIdOf(steps[i]) : undefined;
    if (resumedApproval) {
      result = {
        summary: steps[i].summary ?? "Waiting for approval.",
        output: steps[i].output ?? "",
        approvalId: resumedApproval,
      };
      ctx.log(`resumed — still waiting for guardian approval (${resumedApproval})`);
    } else {
      steps[i].status = "running";
      ctx.emit([...steps]);
      await new Promise((r) => setTimeout(r, 420));
      try {
        result = await defs[i].run(ctx, state);
      } catch (e) {
        steps[i].status = "failed";
        steps[i].summary = `Step crashed: ${String(e)}`;
        steps[i].output = String(e);
        ctx.emit([...steps]);
        await persistRun(ctx, mission, steps, state, "failed", startedAt);
        return;
      }
    }

    if (result.approvalId) {
      steps[i].status = "blocked";
      steps[i].summary = result.summary;
      steps[i].output = result.output;
      steps[i].approvalId = result.approvalId;
      ctx.emit([...steps]);
      ctx.onBlocked(steps[i]);
      void persistRun(ctx, mission, steps, state, "running", startedAt);
      if (!resumedApproval) ctx.log(`waiting for guardian approval (${result.approvalId})`);

      const outcome = await waitForApproval(ctx, result.approvalId);
      if (outcome === "cancelled") {
        // Stop pressed while parked: the approval stays pending for a guardian.
        for (let j = i; j < steps.length; j++) {
          if (steps[j].status !== "done") steps[j].status = "skipped";
        }
        steps[i].summary =
          `${steps[i].summary ?? ""} Run stopped — the approval is still pending in Approvals.`.trim();
        ctx.emit([...steps]);
        await persistRun(ctx, mission, steps, state, "cancelled", startedAt);
        return;
      }
      ctx.onUnblocked(steps[i], outcome);

      if (outcome === "approved") {
        steps[i].status = "done";
        steps[i].summary = "Approved by the guardian — payment executed and the agent resumed.";
        const amt = Number(/\$([\d.]+)/.exec(steps[i].title)?.[1] ?? 0);
        state.spentUsd += amt;
        state.purchases.push({
          amount: amt.toFixed(2),
          destination: "approved purchase",
          rail: "approved",
        });
        ctx.log("approved by guardian — continuing");
      } else {
        steps[i].status = "failed";
        steps[i].summary =
          `Guardian ${outcome} the request — the agent replans without this purchase.`;
        ctx.log(`guardian ${outcome} — replanning`);
      }
      ctx.emit([...steps]);
      void persistRun(ctx, mission, steps, state, "running", startedAt);
      continue;
    }

    steps[i].status = result.softFail ? "failed" : "done";
    steps[i].summary = result.summary;
    steps[i].output = result.output;
    ctx.emit([...steps]);
    void persistRun(ctx, mission, steps, state, "running", startedAt);

    if (result.abort) {
      for (let j = i + 1; j < steps.length; j++) steps[j].status = "skipped";
      ctx.emit([...steps]);
      await persistRun(ctx, mission, steps, state, "failed", startedAt, mission.deliverable(state));
      return;
    }
  }

  const deliverable = mission.deliverable(state);
  await persistRun(ctx, mission, steps, state, "complete", startedAt, deliverable);
  ctx.log(`deliverable ready — ${mission.deliverableKind}`);
}

/** Mark a persisted run as cancelled without resuming it (e.g. after a reload). */
export async function cancelPersistedRun(
  ctx: Pick<WorkflowCtx, "guardian" | "runId" | "agentId" | "agentName">,
  record: {
    missionId: string;
    title: string;
    startedAt: string;
    costUsdc?: string;
    steps: RunStep[];
  },
): Promise<void> {
  await G.saveRun(ctx.guardian, ctx.runId, {
    missionId: record.missionId,
    title: record.title,
    agentId: ctx.agentId,
    agentName: ctx.agentName,
    status: "cancelled",
    startedAt: record.startedAt,
    finishedAt: new Date().toISOString(),
    costUsdc: Number(record.costUsdc ?? 0).toFixed(6),
    steps: record.steps.map((s) => ({
      id: s.id,
      title: s.title,
      detail: s.detail,
      status: s.status === "done" || s.status === "failed" ? s.status : "skipped",
      summary: s.summary,
      output: s.output,
    })),
  }).catch(() => undefined);
}

async function waitForApproval(
  ctx: WorkflowCtx,
  approvalId: string,
): Promise<"approved" | "denied" | "expired" | "cancelled"> {
  for (;;) {
    if (ctx.cancelled()) return "cancelled";
    await new Promise((r) => setTimeout(r, 2000));
    if (ctx.cancelled()) return "cancelled";
    const { data } = await A.getApproval(ctx.agent, approvalId).catch(() => ({
      status: 0,
      data: {} as Record<string, unknown>,
    }));
    const status = (data.approval as Record<string, string> | undefined)?.status;
    if (status === "approved") return "approved";
    if (status === "denied") return "denied";
    if (status === "expired") return "expired";
    // The rules changed while it waited: cancelled, nothing sent. Treated as
    // a refusal; the run must re-request under the current rules.
    if (status === "cancelled_stale") return "denied";
  }
}
