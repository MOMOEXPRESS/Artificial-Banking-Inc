"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { Empty, Icon, fmtUsd } from "./ui";
import type { Approval, Session, Shared } from "./console-types";
import type { Policy } from "./policy-view";
import type { Run } from "./views";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { SegTabs } from "@/components/ui/seg-tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { explainApiResponse, relatedConsoleViews } from "./scenario-result";
import { browserApiBase, sellerUrl } from "./browser-api";
import { agentClient, guardianClient } from "./flows/client";
import * as A from "./flows/agent";
import * as G from "./flows/guardian";
import {
  CUSTOM_STEP_CATALOG,
  compileCustomMission,
  defaultRunSheet,
  maxSpend,
  newCustomStep,
  type CustomStepDraft,
  type CustomStepKind,
} from "./workflow/builder";
import {
  RUN_REPEATS,
  approvalIdOf,
  cancelPersistedRun,
  newRunId,
  planRun,
  runMission,
  type ResumePoint,
  type RunRepeat,
} from "./workflow/engine";
import type { Mission, RunStep, WorkflowCtx } from "./workflow/types";
// The playground is the one place allowed to use the training layer.
import {
  MISSIONS,
  OUTCOME_LABEL,
  SCENARIO_GROUPS,
  TRAINING_STEP_KINDS,
  estimatedMaxUsd,
  findMission,
  isTrainingEnabled,
} from "./playground/training";

const API = browserApiBase();
const SELLER = sellerUrl();
const RUN_MISSIONS_KEY = "abi_run_missions";

export type PlaygroundSource = "scenarios" | "custom";
export type SourceRun = { steps: RunStep[]; log: string[]; title?: string; runId?: string };

export type MissionState = {
  /** Selected guided scenario. */
  missionId: string;
  actorId: string;
  running: boolean;
  /** Which tab owns the active (or last) run. */
  runningSource: PlaygroundSource | null;
  /** Guided and custom keep separate timelines so switching never mixes them. */
  runs: Record<PlaygroundSource, SourceRun>;
};

export const emptyMissionState: MissionState = {
  missionId: "brief",
  actorId: "",
  running: false,
  runningSource: null,
  runs: { scenarios: { steps: [], log: [] }, custom: { steps: [], log: [] } },
};

type Budget = { available: number; dailyRemaining: number; frozen: boolean };

type CustomDraft = { title: string; brief: string; steps: CustomStepDraft[]; realSpend: boolean };

/** Remember how to rebuild a run's plan so it can resume after a reload. */
function rememberRunMission(runId: string, entry: { missionId: string; custom?: CustomDraft }) {
  try {
    const all = JSON.parse(sessionStorage.getItem(RUN_MISSIONS_KEY) ?? "{}") as Record<
      string,
      unknown
    >;
    all[runId] = entry;
    const ids = Object.keys(all);
    for (const id of ids.slice(0, Math.max(0, ids.length - 20))) delete all[id];
    sessionStorage.setItem(RUN_MISSIONS_KEY, JSON.stringify(all));
  } catch {
    /* resume is best-effort */
  }
}
function recallRunMission(runId: string): { missionId: string; custom?: CustomDraft } | null {
  try {
    const all = JSON.parse(sessionStorage.getItem(RUN_MISSIONS_KEY) ?? "{}") as Record<
      string,
      { missionId: string; custom?: CustomDraft }
    >;
    return all[runId] ?? null;
  } catch {
    return null;
  }
}

const stamp = () => new Date().toLocaleTimeString([], { hour12: false });

export function Playground({
  session,
  updateSession,
  policy,
  busy,
  act,
  gFetch,
  org,
  setView,
  setToast,
  pending,
  mission: ms,
  setMission,
  cancelRef,
  readOnly,
  runs: savedRuns = [],
}: Shared & {
  session: Session;
  updateSession: (patch: Partial<Session>) => void;
  policy: Policy | null;
  pending: Approval[];
  mission: MissionState;
  setMission: Dispatch<SetStateAction<MissionState>>;
  /** Owned by the shell so Stop still works after navigating away and back. */
  cancelRef: MutableRefObject<boolean>;
  runs?: Run[];
}) {
  const training = isTrainingEnabled(org);
  const live = org?.ledgerMode === "live";
  const [pasteKey, setPasteKey] = useState("");
  const [shownRaw, setShownRaw] = useState<Record<string, boolean>>({});
  const [repeat, setRepeat] = useState<RunRepeat>("once");
  const [e2eWallet, setE2eWallet] = useState(() => {
    try {
      return typeof window !== "undefined" ? (sessionStorage.getItem("abi_e2e_wallet") ?? "") : "";
    } catch {
      return "";
    }
  });
  const [e2eAmount, setE2eAmount] = useState("0.10");
  const [catFilter, setCatFilter] = useState<"all" | Mission["category"]>("all");
  const [scenarioQuery, setScenarioQuery] = useState("");
  const [sourcePick, setSource] = useState<PlaygroundSource>("scenarios");
  const source: PlaygroundSource = training ? sourcePick : "custom";
  const [customTitle, setCustomTitle] = useState("Would we survive?");
  const [customBrief, setCustomBrief] = useState("");
  const [customSteps, setCustomSteps] = useState<CustomStepDraft[]>(defaultRunSheet);
  const [realSpend, setRealSpend] = useState(false);
  const [budget, setBudget] = useState<Budget | null>(null);
  const [dismissedResume, setDismissedResume] = useState<string | null>(null);
  const stepsRef = useRef<HTMLDivElement | null>(null);

  const { missionId, running, actorId, runningSource } = ms;
  const view = ms.runs[source];
  const steps = view.steps;
  const log = view.log;
  const patch = (p: Partial<MissionState>) => setMission((m) => ({ ...m, ...p }));
  const patchRun = useCallback(
    (src: PlaygroundSource, fn: (r: SourceRun) => SourceRun) =>
      setMission((m) => ({ ...m, runs: { ...m.runs, [src]: fn(m.runs[src]) } })),
    [setMission],
  );

  useEffect(() => {
    if (!stepsRef.current || steps.length === 0) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const last = stepsRef.current.querySelector(".step:last-child");
    if (last) {
      gsap.fromTo(
        last,
        { y: 10, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.28, ease: "power2.out" },
      );
    }
  }, [steps]);

  const extraKinds = training ? TRAINING_STEP_KINDS : [];
  const stepCatalog = [...CUSTOM_STEP_CATALOG, ...extraKinds];
  const guided = findMission(missionId) ?? MISSIONS[0];
  const customMission = useMemo(
    () =>
      compileCustomMission(
        { title: customTitle, brief: customBrief, steps: customSteps },
        { realSpend, extraKinds: training ? TRAINING_STEP_KINDS : [], sellerUrl: SELLER },
      ),
    [customTitle, customBrief, customSteps, realSpend, training],
  );
  const activeMission = source === "custom" ? customMission : guided;
  const actor = session.agentKeys.find((k) => k.agentId === actorId) ?? session.agentKeys[0];
  const peer = session.agentKeys.find((k) => k.agentId !== actor?.agentId);
  const guardian = useMemo(() => guardianClient(gFetch), [gFetch]);

  const visibleMissions = MISSIONS.filter((m) => {
    const inCategory = catFilter === "all" || m.category === catFilter;
    const query = scenarioQuery.trim().toLowerCase();
    const matchesQuery =
      !query || [m.title, m.brief, m.persona, ...m.tags].join(" ").toLowerCase().includes(query);
    return inCategory && matchesQuery;
  });
  const visibleGroups = SCENARIO_GROUPS.map((group) => ({
    ...group,
    missions: visibleMissions.filter((m) => m.category === group.id),
  })).filter((group) => group.missions.length > 0);

  useEffect(() => {
    if (!actorId && session.agentKeys[0]) patch({ actorId: session.agentKeys[0].agentId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.agentKeys, actorId]);

  /* ---- budget headroom for the acting agent ---- */
  const refreshBudget = useCallback(async () => {
    if (!actor) return setBudget(null);
    try {
      const { status, data } = await A.getBudget(agentClient(API, actor.key));
      if (status >= 400) return;
      setBudget({
        available: Number(data.availableUsdc ?? 0),
        dailyRemaining: Number(data.dailyRemainingUsdc ?? data.availableUsdc ?? 0),
        frozen: !!data.frozen,
      });
    } catch {
      /* headroom is advisory */
    }
  }, [actor]);
  useEffect(() => {
    void refreshBudget();
  }, [refreshBudget, running]);

  const estimate =
    source === "custom" ? (realSpend ? maxSpend(customSteps) : 0) : estimatedMaxUsd(activeMission);
  const overBudget = !!budget && estimate > 0 && estimate > budget.dailyRemaining;

  /* ---- run ---- */
  const makeCtx = (
    src: PlaygroundSource,
    runId: string,
    agent: { agentId: string; name: string; key: string },
  ): WorkflowCtx => ({
    agent: agentClient(API, agent.key),
    guardian,
    agentId: agent.agentId,
    agentName: agent.name,
    runId,
    payeeAgentId: session.agentKeys.find((k) => k.agentId !== agent.agentId)?.agentId,
    sellerUrl: SELLER,
    e2eWallet: e2eWallet.trim() || undefined,
    e2eAmountUsdc: e2eAmount.trim() || "0.10",
    emit: (nextSteps) => patchRun(src, (r) => ({ ...r, steps: nextSteps })),
    log: (line) => patchRun(src, (r) => ({ ...r, log: [...r.log, `${stamp()}  ${line}`] })),
    onBlocked: () => {
      /* the parked-run banner + the shell's approval watcher handle this */
    },
    onUnblocked: (_s, outcome) =>
      setToast(
        outcome === "approved"
          ? "Approved — the agent picked straight back up."
          : `Agent was told: ${outcome}. It is replanning without that spend.`,
        outcome === "approved" ? "ok" : "info",
      ),
    cancelled: () => cancelRef.current,
  });

  const disabledReason = !actor
    ? "Add an agent key below to run."
    : readOnly
      ? "Viewer role is read-only."
      : running && runningSource !== source
        ? `Finish or stop the ${runningSource === "custom" ? (training ? "custom" : "workflow") : "guided"} run first — one run at a time.`
        : running
          ? null
          : budget?.frozen
          ? "This agent is frozen — unfreeze it under Agents."
          : null;

  async function start() {
    if (!actor || running) return;
    const src = source;
    const queue = planRun(activeMission, repeat, findMission);
    if (!training && queue.some((m) => m.destructive || m.editsPolicy)) {
      setToast("Drills and policy-editing scenarios only run on sandbox orgs.", "err");
      return;
    }
    if (src === "custom" && realSpend && live) {
      const ok = window.confirm(
        `This run moves real money from ${actor.name}'s budget (up to ${fmtUsd(String(maxSpend(customSteps)))}). Continue?`,
      );
      if (!ok) return;
    }
    cancelRef.current = false;
    setShownRaw({});
    setMission((m) => ({
      ...m,
      running: true,
      runningSource: src,
      runs: { ...m.runs, [src]: { steps: [], log: [], title: activeMission.title } },
    }));
    try {
      for (let qi = 0; qi < queue.length; qi++) {
        if (cancelRef.current) break;
        const m = queue[qi];
        const runId = newRunId();
        rememberRunMission(
          runId,
          src === "custom"
            ? {
                missionId: m.id,
                custom: { title: customTitle, brief: customBrief, steps: customSteps, realSpend },
              }
            : { missionId: m.id },
        );
        patchRun(src, (r) => ({
          ...r,
          runId,
          log: [...r.log, `${stamp()}  ▶ ${m.title} (${qi + 1}/${queue.length})`],
        }));
        await runMission(m, makeCtx(src, runId, actor));
      }
    } finally {
      setMission((m) => ({ ...m, running: false }));
      void refreshBudget();
    }
  }

  const stop = () => {
    cancelRef.current = true;
    setToast("Stopping the run…", "info");
  };

  const resolve = (approvalId: string, approve: boolean) =>
    act("Approval", async () => {
      const { status, data } = await G.resolveApproval(guardian, approvalId, approve, "playground");
      if (status >= 400)
        throw new Error(JSON.stringify((data as { error?: unknown }).error ?? data));
      if (data.pendingQuorum) {
        return (
          (data.message as string | undefined) ??
          `Vote recorded — ${data.have} of ${data.need} guardians.`
        );
      }
      return approve ? "Approved — watch the agent continue." : "Denied — the agent will replan.";
    });

  const addKey = () =>
    act("Add key", async () => {
      const key = pasteKey.trim();
      const { status, data: d } = await A.getBudget(agentClient(API, key));
      if (status >= 400) throw new Error("That agent key was rejected by the API");
      if (!d.agentId) throw new Error("API did not return agentId — redeploy API and retry");
      updateSession({
        agentKeys: [
          ...session.agentKeys.filter((k) => k.agentId !== d.agentId && k.key !== key),
          {
            agentId: String(d.agentId),
            name: String(d.agentName ?? "Pasted agent"),
            key,
          },
        ],
      });
      patch({ actorId: String(d.agentId) });
      setPasteKey("");
      return `Added ${d.agentName ?? d.agentId} for this tab.`;
    });

  /* ---- parked run (live) and interrupted run (after reload) ---- */
  const activeRun = runningSource ? ms.runs[runningSource] : null;
  const parkedStep = running ? activeRun?.steps.find((s) => s.status === "blocked") : undefined;
  const otherRunning = running && runningSource !== source;

  const interrupted = useMemo(() => {
    if (running) return null;
    const cutoff = Date.now() - 24 * 3600_000;
    for (const r of savedRuns) {
      if (r.status !== "running" || r.id === dismissedResume) continue;
      if (new Date(r.startedAt).getTime() < cutoff) continue;
      const parked = r.steps.find((s) => s.status === "blocked" && approvalIdOf(s));
      if (parked) return { run: r, step: parked, approvalId: approvalIdOf(parked)! };
    }
    return null;
  }, [savedRuns, running, dismissedResume]);

  async function resumeInterrupted() {
    if (!interrupted || running) return;
    const { run } = interrupted;
    const agent = session.agentKeys.find((k) => k.agentId === run.agentId);
    if (!agent) {
      setToast(
        "Add this run's agent key in Run controls to resume it, or approve/deny it here.",
        "err",
      );
      return;
    }
    const remembered = recallRunMission(run.id);
    const mission: Mission | undefined = remembered?.custom
      ? compileCustomMission(
          {
            title: remembered.custom.title,
            brief: remembered.custom.brief,
            steps: remembered.custom.steps,
          },
          {
            id: run.missionId,
            realSpend: remembered.custom.realSpend,
            extraKinds: training ? TRAINING_STEP_KINDS : [],
            sellerUrl: SELLER,
          },
        )
      : findMission(run.missionId);
    if (!mission) {
      setToast(
        "This run's plan is not available in this tab. Approve or deny it, or cancel the run.",
        "err",
      );
      return;
    }
    const src: PlaygroundSource = run.missionId.startsWith("custom_") ? "custom" : "scenarios";
    const resume: ResumePoint = {
      steps: run.steps.map((s) => ({
        id: s.id,
        title: s.title,
        detail: s.detail ?? "",
        status: s.status as RunStep["status"],
        summary: s.summary,
        output: s.output,
      })),
      startedAt: run.startedAt,
      costUsdc: run.costUsdc,
    };
    setDismissedResume(run.id);
    if (training) setSource(src);
    cancelRef.current = false;
    setMission((m) => ({
      ...m,
      running: true,
      runningSource: src,
      actorId: agent.agentId,
      runs: {
        ...m.runs,
        [src]: {
          steps: [],
          log: [`${stamp()}  ↻ resumed ${run.title}`],
          title: run.title,
          runId: run.id,
        },
      },
    }));
    try {
      await runMission(mission, makeCtx(src, run.id, agent), resume);
    } finally {
      setMission((m) => ({ ...m, running: false }));
      void refreshBudget();
    }
  }

  async function cancelInterrupted() {
    if (!interrupted) return;
    const { run } = interrupted;
    setDismissedResume(run.id);
    await cancelPersistedRun(
      { guardian, runId: run.id, agentId: run.agentId, agentName: run.agentName },
      {
        missionId: run.missionId,
        title: run.title,
        startedAt: run.startedAt,
        costUsdc: run.costUsdc,
        steps: run.steps.map((s) => ({
          id: s.id,
          title: s.title,
          detail: s.detail ?? "",
          status: s.status as RunStep["status"],
          summary: s.summary,
          output: s.output,
        })),
      },
    );
    setToast("Run cancelled. Its approval stays in Approvals until someone decides.", "info");
  }

  const blockedStep = steps.find((s) => s.status === "blocked");
  const done = steps.filter((s) => s.status === "done").length;
  const sourceLabel = (s: PlaygroundSource) =>
    s === "custom" ? (training ? "custom" : "workflow") : "guided";

  return (
    <div className="console-page playground-page">
      <header className="playground-hero">
        <div>
          <div className="playground-eyebrow" data-testid="playground-mode">
            <span className={`playground-live-dot ${live ? "live" : ""}`} />{" "}
            {training
              ? "Practice · sandbox org · real policy engine"
              : live
                ? "Live workflow · real money · real policy engine"
                : "Workflow · real policy engine"}
          </div>
          <h1>
            {training
              ? "Test how an agent behaves before money is at risk."
              : "Run your agents' real work, under live policy."}
          </h1>
          <p>
            {training
              ? "Guided exercises and your own run sheets call the same APIs your agents use in production. Practice tools only appear while this org is in sandbox mode."
              : "Compose the steps an agent should take — budget, pay, x402, escrow — and run them through the production APIs. Live runs never change your policy."}
          </p>
        </div>
        <div className="playground-hero-stats" aria-label="Playground summary">
          <div>
            <b>{training ? MISSIONS.length : stepCatalog.length}</b>
            <span>{training ? "guided scenarios" : "workflow actions"}</span>
          </div>
          <div>
            <b>{budget ? fmtUsd(String(budget.dailyRemaining)) : "—"}</b>
            <span>{actor ? `${actor.name} can spend today` : "no acting agent"}</span>
          </div>
          <div>
            <b>{live ? "Live" : "Sandbox"}</b>
            <span>ledger mode</span>
          </div>
        </div>
      </header>

      {parkedStep?.approvalId && (
        <div className="banner warn lab-run-banner" role="status" data-testid="parked-banner">
          <span className="ico">
            <Icon name="clock" size={16} />
          </span>
          <span className="txt">
            <b>
              {runningSource === source ? "This" : `Your ${sourceLabel(runningSource!)}`} run is
              waiting for your approval
            </b>
            <span>
              {parkedStep.title}. The agent cannot spend until you decide — or stop the run and the
              approval stays in Approvals.
            </span>
          </span>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy || readOnly}
            onClick={() => void resolve(parkedStep.approvalId!, true)}
          >
            Approve
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={busy || readOnly}
            onClick={() => void resolve(parkedStep.approvalId!, false)}
          >
            Deny
          </Button>
          <Button size="sm" variant="ghost" onClick={stop}>
            Stop run
          </Button>
        </div>
      )}

      {otherRunning && !parkedStep && (
        <div className="banner info lab-run-banner" role="status" data-testid="other-run-banner">
          <span className="ico">
            <Icon name="play" size={16} />
          </span>
          <span className="txt">
            <b>A {sourceLabel(runningSource!)} run is in progress</b>
            <span>You can pick what to run next; Run unlocks when it finishes.</span>
          </span>
          {training && (
            <Button size="sm" variant="secondary" onClick={() => setSource(runningSource!)}>
              View it
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={stop}>
            Stop run
          </Button>
        </div>
      )}

      {interrupted && (
        <div className="banner warn lab-run-banner" role="status" data-testid="resume-banner">
          <span className="ico">
            <Icon name="clock" size={16} />
          </span>
          <span className="txt">
            <b>A run stopped when the page reloaded: {interrupted.run.title}</b>
            <span>
              It is still waiting for approval on “{interrupted.step.title}”. Resume to keep
              watching it, decide now, or cancel the run.
            </span>
          </span>
          <Button size="sm" disabled={readOnly} onClick={() => void resumeInterrupted()}>
            Resume
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy || readOnly}
            onClick={() => void resolve(interrupted.approvalId, true)}
          >
            Approve
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={busy || readOnly}
            onClick={() => void resolve(interrupted.approvalId, false)}
          >
            Deny
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={readOnly}
            onClick={() => void cancelInterrupted()}
          >
            Cancel run
          </Button>
        </div>
      )}

      <section className="lab-panel lab-library">
        <div className="lab-section-head">
          <div>
            <span className="lab-kicker">01 · Choose the work</span>
            <h2>
              {source === "custom"
                ? training
                  ? "Build a custom mission"
                  : "Build the workflow"
                : "Scenario library"}
            </h2>
            <p>
              {source === "custom"
                ? "List the real API actions in the order the agent should take them."
                : "Start with a safe preflight, prove a payment path, or pressure-test a control."}
            </p>
          </div>
          {training && (
            <SegTabs
              value={source}
              onValueChange={(v) => setSource(v as PlaygroundSource)}
              items={
                [
                  { value: "scenarios", label: "Guided scenarios" },
                  { value: "custom", label: "Custom mission" },
                ] as const
              }
            />
          )}
        </div>

        {source === "scenarios" ? (
          <>
            <div className="lab-library-tools">
              <SegTabs
                value={catFilter}
                onValueChange={(v) => setCatFilter(v as typeof catFilter)}
                items={
                  [
                    { value: "all", label: "All" },
                    { value: "commerce", label: "Payments" },
                    { value: "governance", label: "Controls" },
                    { value: "security", label: "Security" },
                    { value: "ops", label: "Workflows" },
                  ] as const
                }
              />
              <label className="lab-search">
                <Icon name="search" size={15} />
                <input
                  type="search"
                  value={scenarioQuery}
                  onChange={(e) => setScenarioQuery(e.target.value)}
                  placeholder="Search scenarios"
                  aria-label="Search scenarios"
                />
              </label>
            </div>

            {visibleGroups.length ? (
              <div className="scenario-groups">
                {visibleGroups.map((group) => (
                  <div className="scenario-group" key={group.id}>
                    <div className="scenario-group-head">
                      <span className="scenario-group-icon">
                        <Icon name={group.icon} size={16} />
                      </span>
                      <div>
                        <h3>{group.label}</h3>
                        <p>{group.description}</p>
                      </div>
                      <span className="scenario-count">{group.missions.length}</span>
                    </div>
                    <div className="scenario-grid">
                      {group.missions.map((m) => (
                        <button
                          key={m.id}
                          className={`scenario-card ${m.id === missionId ? "selected" : ""}`}
                          onClick={() => patch({ missionId: m.id })}
                          data-mission={m.id}
                        >
                          <span className="scenario-card-top">
                            <span className={`outcome-pill ${m.expectedOutcome}`}>
                              {OUTCOME_LABEL[m.expectedOutcome]}
                            </span>
                            <span className="scenario-difficulty">
                              {m.chain ? "chain" : m.difficulty}
                            </span>
                          </span>
                          <strong>{m.title}</strong>
                          <span className="scenario-brief">{m.brief}</span>
                          <span className="scenario-meta">
                            <span>
                              <Icon name="clock" size={12} /> {m.duration}
                            </span>
                            <span>
                              <Icon name="wallet" size={12} /> {m.estimatedCost}
                            </span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <Empty icon="search">No scenarios match that search.</Empty>
            )}
          </>
        ) : (
          <div className="custom-mission-builder">
            <div className="custom-mission-copy">
              <label className="field">
                <span>{training ? "Mission title" : "Workflow name"}</span>
                <input
                  value={customTitle}
                  disabled={running && runningSource === "custom"}
                  onChange={(e) => setCustomTitle(e.target.value)}
                />
              </label>
              <label className="field">
                <span>What should this run prove or do?</span>
                <textarea
                  value={customBrief}
                  disabled={running && runningSource === "custom"}
                  onChange={(e) => setCustomBrief(e.target.value)}
                  placeholder="Describe the payment path or policy behaviour."
                  rows={4}
                />
              </label>
              <label className="lab-real-spend" data-testid="real-spend-toggle">
                <input
                  type="checkbox"
                  checked={realSpend}
                  disabled={running || readOnly}
                  onChange={(e) => setRealSpend(e.target.checked)}
                />
                <span>
                  <b>Allow real spend</b>
                  <small>
                    {realSpend
                      ? `Spend steps move money from the agent's budget (up to ${fmtUsd(String(maxSpend(customSteps)))}).`
                      : "Off: every spend step is a dry run — the policy engine answers, no money moves."}
                  </small>
                </span>
              </label>
              {!training && (
                <p className="lab-help">
                  Live runs never change your policy. Destinations must already be allowed —{" "}
                  <button type="button" className="link-btn" onClick={() => setView("policy")}>
                    manage them in Policies
                  </button>
                  .
                </p>
              )}
            </div>
            <div className="custom-step-list">
              <div className="between">
                <div>
                  <b>Run sheet</b>
                  <span>{customSteps.length} ordered steps</span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={running && runningSource === "custom"}
                  onClick={() => setCustomSteps((rows) => [...rows, newCustomStep("simulate")])}
                >
                  <Icon name="plus" size={12} /> Add step
                </Button>
              </div>
              {customSteps.map((step, idx) => {
                const meta = stepCatalog.find((c) => c.kind === step.kind);
                const locked = running && runningSource === "custom";
                return (
                  <div className="custom-step" key={step.id}>
                    <span className="custom-step-number">{String(idx + 1).padStart(2, "0")}</span>
                    <div className="custom-step-body">
                      <select
                        value={step.kind}
                        disabled={locked}
                        aria-label={`Step ${idx + 1} action`}
                        onChange={(e) => {
                          const kind = e.target.value as CustomStepKind;
                          const next = newCustomStep(kind, extraKinds);
                          setCustomSteps((rows) =>
                            rows.map((r, i) => (i === idx ? { ...next, id: r.id } : r)),
                          );
                        }}
                      >
                        {stepCatalog.map((c) => (
                          <option key={c.kind} value={c.kind}>
                            {c.label}
                            {c.spends && !realSpend ? " (dry run)" : ""}
                          </option>
                        ))}
                      </select>
                      <p>{meta?.detail}</p>
                      {(meta?.needsAmount || meta?.needsDestination) && (
                        <div className="custom-step-inputs">
                          {meta.needsAmount && (
                            <input
                              value={step.amount ?? ""}
                              disabled={locked}
                              placeholder="Amount"
                              aria-label="Amount"
                              inputMode="decimal"
                              onChange={(e) =>
                                setCustomSteps((rows) =>
                                  rows.map((r, i) =>
                                    i === idx ? { ...r, amount: e.target.value } : r,
                                  ),
                                )
                              }
                            />
                          )}
                          {meta.needsDestination && (
                            <input
                              value={step.destination ?? ""}
                              disabled={locked}
                              placeholder="Destination"
                              aria-label="Destination"
                              onChange={(e) =>
                                setCustomSteps((rows) =>
                                  rows.map((r, i) =>
                                    i === idx ? { ...r, destination: e.target.value } : r,
                                  ),
                                )
                              }
                            />
                          )}
                        </div>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={locked || customSteps.length <= 1}
                      onClick={() => setCustomSteps((rows) => rows.filter((_, i) => i !== idx))}
                    >
                      Remove
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      <section className="lab-briefing">
        <div className="lab-briefing-main">
          <span className="lab-kicker">02 · Review and run</span>
          <div className="lab-briefing-title">
            <div>
              <span className={`outcome-pill ${activeMission.expectedOutcome}`}>
                {OUTCOME_LABEL[activeMission.expectedOutcome]}
              </span>
              <h2>{activeMission.title}</h2>
              <p>{activeMission.brief}</p>
            </div>
            <div className="lab-run-control" data-testid="run-control">
              {running && runningSource === source ? (
                <Button variant="destructive" onClick={stop} data-testid="stop-run">
                  Stop run
                </Button>
              ) : (
                <div className="split-button">
                  <Button
                    disabled={!!disabledReason || busy}
                    onClick={() => void start()}
                    data-testid="run-button"
                  >
                    <Icon name="play" size={14} /> {repeat === "repeat3" ? "Run ×3" : "Run"}
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="secondary"
                        aria-label="Run options"
                        disabled={!!disabledReason || busy}
                        data-testid="run-options"
                      >
                        ▾
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>How many times</DropdownMenuLabel>
                      {RUN_REPEATS.map((r) => (
                        <DropdownMenuItem key={r.id} onSelect={() => setRepeat(r.id)}>
                          <span className="run-opt">
                            <b>
                              {repeat === r.id ? "● " : "○ "}
                              {r.label}
                            </b>
                            <small>{r.detail}</small>
                          </span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}
              {disabledReason && (!running || runningSource !== source) && (
                <small className="run-disabled-reason" data-testid="run-disabled-reason">
                  {disabledReason}
                </small>
              )}
              {!disabledReason && !running && overBudget && (
                <small className="run-disabled-reason warn" data-testid="over-budget">
                  May exceed today&apos;s headroom ({fmtUsd(String(budget!.dailyRemaining))}) —
                  later steps can be refused.
                </small>
              )}
            </div>
          </div>
          <div className="lab-briefing-meta">
            <span>
              <Icon name="robot" size={14} />
              <i>Persona</i>
              <b>{activeMission.persona}</b>
            </span>
            <span>
              <Icon name="clock" size={14} />
              <i>Typical time</i>
              <b>{activeMission.duration}</b>
            </span>
            <span>
              <Icon name="wallet" size={14} />
              <i>Can spend</i>
              <b>{activeMission.estimatedCost}</b>
            </span>
            <span>
              <Icon name="layers" size={14} />
              <i>Agent headroom today</i>
              <b data-testid="headroom">{budget ? fmtUsd(String(budget.dailyRemaining)) : "—"}</b>
            </span>
          </div>
          <div className="lab-tags">
            {activeMission.tags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
        </div>

        {source === "scenarios" && missionId === "onchain_wallet" && (
          <div className="onchain-run-config">
            <div>
              <b>On-chain proof settings</b>
              <p>
                The agent calls <code>/v1/agent/pay</code>; policy and the vault broadcast USDC.
              </p>
            </div>
            <label className="field">
              <span>Base Sepolia wallet</span>
              <input
                className="mono"
                value={e2eWallet}
                disabled={running || readOnly}
                placeholder="0x…"
                onChange={(e) => {
                  const v = e.target.value.trim();
                  setE2eWallet(v);
                  try {
                    if (/^0x[a-fA-F0-9]{40}$/.test(v)) sessionStorage.setItem("abi_e2e_wallet", v);
                  } catch {
                    /* ignore */
                  }
                }}
              />
            </label>
            <label className="field">
              <span>Amount (USDC)</span>
              <input
                value={e2eAmount}
                disabled={running || readOnly}
                placeholder="0.10"
                onChange={(e) => setE2eAmount(e.target.value)}
              />
            </label>
          </div>
        )}
      </section>

      <div className="lab-workspace">
        <section className="lab-panel lab-timeline">
          <div className="lab-section-head compact">
            <div>
              <span className="lab-kicker">03 · Observe and inspect</span>
              <h2>
                {running && runningSource === source
                  ? "Agent is executing"
                  : steps.length
                    ? `Latest ${sourceLabel(source)} run${view.title ? `: ${view.title}` : ""}`
                    : "Execution timeline"}
              </h2>
              <p>
                {steps.length
                  ? `${done}/${steps.length} steps complete${blockedStep ? " · waiting for your decision" : ""}`
                  : "Every API call, policy decision, and settlement result will appear here."}
              </p>
            </div>
            {steps.length > 0 && !(running && runningSource === source) && (
              <Button variant="ghost" size="sm" onClick={() => setView("work")}>
                Open deliverable <Icon name="arrowRight" size={12} />
              </Button>
            )}
          </div>

          <div className="lab-timeline-body">
            {steps.length === 0 ? (
              <div className="lab-empty-state">
                <span>
                  <Icon name="play" size={22} />
                </span>
                <h3>Ready for a controlled run</h3>
                <p>
                  {training
                    ? "Pick a scenario or build a run sheet, check the expected outcome, then press Run above."
                    : "Build the run sheet, then press Run above."}{" "}
                  Acting agent: {actor?.name ?? "none yet"}.
                </p>
              </div>
            ) : (
              <div className="steps" ref={stepsRef}>
                {steps.map((s, i) => {
                  const result = s.output ? explainApiResponse(s.output, s.summary) : null;
                  const related = relatedConsoleViews(s);
                  return (
                    <div
                      key={s.id + i}
                      className={`step ${s.status === "done" ? "done" : s.status === "running" ? "run" : s.status === "blocked" ? "block" : s.status === "failed" ? "fail" : ""}`}
                    >
                      <div className="bullet">
                        {s.status === "running" ? (
                          <span className="spinner" />
                        ) : s.status === "done" ? (
                          <Icon name="check" size={13} />
                        ) : s.status === "blocked" ? (
                          <Icon name="clock" size={13} />
                        ) : s.status === "failed" ? (
                          <Icon name="x" size={13} />
                        ) : (
                          i + 1
                        )}
                      </div>
                      <div className="sbody">
                        <b>{s.title}</b>
                        {s.status === "running" ? (
                          <div className="thinking">
                            <span className="bar" /> {s.detail}
                          </div>
                        ) : s.summary ? (
                          <p className="sum">{s.summary}</p>
                        ) : (
                          <p>{s.detail}</p>
                        )}
                        {s.output && result && (
                          <>
                            <button
                              className="step-toggle"
                              onClick={() =>
                                setShownRaw((r) => ({ ...r, [s.id + i]: !r[s.id + i] }))
                              }
                            >
                              {shownRaw[s.id + i] ? "▾ hide explanation" : "▸ explain this result"}
                            </button>
                            {shownRaw[s.id + i] && (
                              <div className="step-explanation">
                                <span>In plain English</span>
                                <b>{result.headline}</b>
                                {result.facts.length > 0 && (
                                  <ul>
                                    {result.facts.map((fact) => (
                                      <li key={fact}>{fact}</li>
                                    ))}
                                  </ul>
                                )}
                                <details className="developer-response">
                                  <summary>Developer response (JSON)</summary>
                                  <div className="out">{s.output}</div>
                                </details>
                              </div>
                            )}
                          </>
                        )}
                        {related.length > 0 && s.status !== "running" && (
                          <div className="step-related">
                            <span>This action also updated</span>
                            <div>
                              {related.map((item) => (
                                <button key={item.view} onClick={() => setView(item.view)}>
                                  {item.label} <Icon name="arrowRight" size={11} />
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        <aside className="lab-rail">
          <section className="lab-panel lab-run-controls">
            <div className="lab-rail-head">
              <span>
                <Icon name="sliders" size={15} />
              </span>
              <div>
                <b>Run controls</b>
                <p>Acting agent and its limits.</p>
              </div>
            </div>
            {!SELLER && (
              <div className="banner warn" style={{ marginBottom: 12 }}>
                <span className="txt">
                  <b>x402 seller not configured</b>
                  <span>
                    Set <span className="mono">NEXT_PUBLIC_SELLER_URL</span> on the console host to
                    a public seller endpoint. x402 steps report a clear soft-fail until then.
                  </span>
                </span>
              </div>
            )}
            {session.agentKeys.length === 0 ? (
              <>
                <p className="lab-help">
                  Create an agent under API, or paste an agent key. Keys are kept for this browser
                  tab only and cleared on sign-out.
                </p>
                <div className="lab-add-key">
                  <input
                    type="password"
                    placeholder="pv_agent_…"
                    value={pasteKey}
                    aria-label="Agent key"
                    onChange={(e) => setPasteKey(e.target.value)}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!pasteKey.trim() || busy || readOnly}
                    onClick={() => void addKey()}
                  >
                    Add
                  </Button>
                </div>
              </>
            ) : (
              <>
                <label className="field">
                  <span>Acting agent</span>
                  <select
                    value={actor?.agentId ?? ""}
                    onChange={(e) => patch({ actorId: e.target.value })}
                    disabled={running}
                  >
                    {session.agentKeys.map((k) => (
                      <option key={k.agentId} value={k.agentId}>
                        {k.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="policy-snapshot">
                  <span>
                    <i>Headroom today</i>
                    <b>{budget ? fmtUsd(String(budget.dailyRemaining)) : "—"}</b>
                  </span>
                  <span>
                    <i>Approval above</i>
                    <b>{fmtUsd(policy?.hitlAboveUsdc)}</b>
                  </span>
                  <span>
                    <i>Payment ceiling</i>
                    <b>{fmtUsd(policy?.perTxMaxUsdc)}</b>
                  </span>
                  <span>
                    <i>Escrow peer</i>
                    <b>{peer ? peer.name : "None"}</b>
                  </span>
                </div>
              </>
            )}
          </section>

          <section className="lab-panel lab-log-panel">
            <div className="lab-rail-head">
              <span>
                <Icon name="list" size={15} />
              </span>
              <div>
                <b>Agent log</b>
                <p>Live operational messages.</p>
              </div>
              {pending.length > 0 && (
                <button className="pending-link" onClick={() => setView("approvals")}>
                  {pending.length} pending
                </button>
              )}
            </div>
            <div className="lab-log">{log.length ? log.join("\n") : "Waiting for a run…"}</div>
          </section>
        </aside>
      </div>
    </div>
  );
}
