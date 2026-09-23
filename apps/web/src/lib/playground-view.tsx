"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { Empty, Icon, fmtUsd } from "./ui";
import {
  MISSIONS,
  runMission,
  missionsForMode,
  RUN_MODES,
  compileCustomMission,
  CUSTOM_STEP_CATALOG,
  newCustomStep,
  type Mission,
  type RunMode,
  type RunStep,
  type CustomStepDraft,
  type CustomStepKind,
} from "./mission";
import type { Approval, Session, Shared } from "./console-types";
import type { Policy } from "./policy-view";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { SegTabs } from "@/components/ui/seg-tabs";

const API = process.env.NEXT_PUBLIC_API_URL ?? "/abi-api";
const SELLER = process.env.NEXT_PUBLIC_SELLER_URL ?? "http://localhost:9402/report";

const SCENARIO_GROUPS: {
  id: Mission["category"];
  label: string;
  description: string;
  icon: string;
}[] = [
  {
    id: "commerce",
    label: "Buy & transact",
    description: "x402 purchases, USDC settlement, escrow, and vendor payments.",
    icon: "wallet",
  },
  {
    id: "governance",
    label: "Approvals & controls",
    description: "Budgets, human review, policy simulation, and reconciliation.",
    icon: "shield",
  },
  {
    id: "security",
    label: "Security drills",
    description: "Adversarial requests and limits that must fail safely.",
    icon: "alert",
  },
  {
    id: "ops",
    label: "Operations & integrations",
    description: "Deployment checks, webhooks, and multi-agent workflows.",
    icon: "sliders",
  },
];

const OUTCOME_LABEL: Record<Mission["expectedOutcome"], string> = {
  allow: "Expected: allow",
  review: "Expected: human review",
  deny: "Expected: deny",
  mixed: "Expected: mixed",
  observe: "Observe only",
};

export type MissionState = {
  missionId: string;
  steps: RunStep[];
  log: string[];
  running: boolean;
  actorId: string;
};

export function Playground({
  session,
  updateSession,
  policy,
  busy,
  act,
  gFetch,
  setView,
  setToast,
  pending,
  mission: ms,
  setMission,
  cancelRef,
  readOnly,
}: Shared & {
  session: Session;
  updateSession: (patch: Partial<Session>) => void;
  policy: Policy | null;
  pending: Approval[];
  mission: MissionState;
  setMission: Dispatch<SetStateAction<MissionState>>;
  /** Owned by the shell so Stop still works after navigating away and back. */
  cancelRef: MutableRefObject<boolean>;
}) {
  const [pasteKey, setPasteKey] = useState("");
  const [shownRaw, setShownRaw] = useState<Record<string, boolean>>({});
  const [runMode, setRunMode] = useState<RunMode>("once");
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
  const [source, setSource] = useState<"scenarios" | "custom">("scenarios");
  const [customTitle, setCustomTitle] = useState("Would we survive?");
  const [customBrief, setCustomBrief] = useState("");
  const [customSteps, setCustomSteps] = useState<CustomStepDraft[]>(() => [
    newCustomStep("budget"),
    newCustomStep("simulate"),
    newCustomStep("pay_api"),
    newCustomStep("summarize"),
  ]);
  const stepsRef = useRef<HTMLDivElement | null>(null);

  const { missionId, steps, log, running, actorId } = ms;
  const patch = (p: Partial<MissionState>) => setMission((m) => ({ ...m, ...p }));

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

  const mission = MISSIONS.find((m) => m.id === missionId) ?? MISSIONS[0];
  const customMission = useMemo(
    () =>
      compileCustomMission({
        title: customTitle,
        brief: customBrief,
        steps: customSteps,
      }),
    [customTitle, customBrief, customSteps],
  );
  const activeMission = source === "custom" ? customMission : mission;
  const actor = session.agentKeys.find((k) => k.agentId === actorId) ?? session.agentKeys[0];
  const peer = session.agentKeys.find((k) => k.agentId !== actor?.agentId);
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

  const blockedStep = steps.find((s) => s.status === "blocked");

  async function start() {
    if (!actor) return;
    cancelRef.current = false;
    setShownRaw({});
    patch({ running: true, steps: [], log: [] });
    const queue =
      source === "custom"
        ? runMode === "stress"
          ? [activeMission, activeMission, activeMission]
          : [activeMission]
        : missionsForMode(runMode, missionId);
    try {
      for (let qi = 0; qi < queue.length; qi++) {
        if (cancelRef.current) break;
        const m = queue[qi];
        const runId = `run_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
        setMission((prev) => ({
          ...prev,
          missionId: m.id.startsWith("custom_") ? prev.missionId : m.id,
          log: [
            ...prev.log,
            `${new Date().toLocaleTimeString([], { hour12: false })}  ▶ ${m.title} (${qi + 1}/${queue.length})`,
          ],
        }));
        await runMission(m, {
          api: API,
          agentKey: actor.key,
          guardianKey: session.guardianKey,
          agentId: actor.agentId,
          agentName: actor.name,
          runId,
          payeeAgentId: peer?.agentId,
          sellerUrl: SELLER,
          e2eWallet: e2eWallet.trim() || undefined,
          e2eAmountUsdc: e2eAmount.trim() || "0.10",
          emit: (nextSteps) => setMission((prev) => ({ ...prev, steps: nextSteps })),
          log: (line) =>
            setMission((prev) => ({
              ...prev,
              log: [
                ...prev.log,
                `${new Date().toLocaleTimeString([], { hour12: false })}  ${line}`,
              ],
            })),
          onBlocked: () => {
            /* the shell's approval watcher raises the alert + banner */
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
      }
    } finally {
      setMission((m) => ({ ...m, running: false }));
    }
  }

  const addKey = () =>
    act("Add key", async () => {
      const key = pasteKey.trim();
      const res = await fetch(`${API}/v1/agent/budget`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) throw new Error("That agent key was rejected by the API");
      const d = (await res.json()) as { agentId?: string; agentName?: string };
      if (!d.agentId) throw new Error("API did not return agentId — redeploy API and retry");
      updateSession({
        agentKeys: [
          ...session.agentKeys.filter((k) => k.agentId !== d.agentId && k.key !== key),
          {
            agentId: d.agentId,
            name: d.agentName ?? "Pasted agent",
            key,
          },
        ],
      });
      patch({ actorId: d.agentId });
      setPasteKey("");
      return `Added ${d.agentName ?? d.agentId} to the Playground.`;
    });

  const resolveInline = (approvalId: string, approve: boolean) =>
    act("Approval", async () => {
      const res = await gFetch(`/v1/guardian/approvals/${approvalId}/resolve`, {
        method: "POST",
        body: JSON.stringify({ approve, resolvedBy: "playground" }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(d.error ?? d));
      if (d.pendingQuorum) {
        return d.message ?? `Vote recorded — ${d.have} of ${d.need} guardians.`;
      }
      return approve ? "Approved — watch the agent continue." : "Denied — the agent will replan.";
    });

  const done = steps.filter((s) => s.status === "done").length;

  return (
    <div className="console-page playground-page">
      <header className="playground-hero">
        <div>
          <div className="playground-eyebrow">
            <span className="playground-live-dot" /> Agent Lab · real policy engine
          </div>
          <h1>Test how an agent behaves before money is at risk.</h1>
          <p>
            Run guided payment, approval, and security exercises against the same APIs your agents
            use in production. Every decision stays inspectable.
          </p>
        </div>
        <div className="playground-hero-stats" aria-label="Playground summary">
          <div>
            <b>{MISSIONS.length}</b>
            <span>guided scenarios</span>
          </div>
          <div>
            <b>4</b>
            <span>test families</span>
          </div>
          <div>
            <b>Live</b>
            <span>policy decisions</span>
          </div>
        </div>
      </header>

      <section className="lab-panel lab-library">
        <div className="lab-section-head">
          <div>
            <span className="lab-kicker">01 · Choose the exercise</span>
            <h2>{source === "custom" ? "Build a custom mission" : "Scenario library"}</h2>
            <p>
              {source === "custom"
                ? "Compose real API actions in the exact order you want ABI to test them."
                : "Start with a safe preflight, prove a payment path, or pressure-test a control."}
            </p>
          </div>
          <SegTabs
            value={source}
            onValueChange={(v) => {
              if (!running) setSource(v as typeof source);
            }}
            items={
              [
                { value: "scenarios", label: "Guided scenarios" },
                { value: "custom", label: "Custom mission" },
              ] as const
            }
          />
        </div>

        {source === "scenarios" ? (
          <>
            <div className="lab-library-tools">
              <SegTabs
                value={catFilter}
                onValueChange={(v) => {
                  if (!running) setCatFilter(v as typeof catFilter);
                }}
                items={
                  [
                    { value: "all", label: "All" },
                    { value: "commerce", label: "Payments" },
                    { value: "governance", label: "Controls" },
                    { value: "security", label: "Security" },
                    { value: "ops", label: "Operations" },
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
                          disabled={running}
                        >
                          <span className="scenario-card-top">
                            <span className={`outcome-pill ${m.expectedOutcome}`}>
                              {OUTCOME_LABEL[m.expectedOutcome]}
                            </span>
                            <span className="scenario-difficulty">{m.difficulty}</span>
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
                <span>Mission title</span>
                <input
                  value={customTitle}
                  disabled={running}
                  onChange={(e) => setCustomTitle(e.target.value)}
                />
              </label>
              <label className="field">
                <span>What should this mission prove?</span>
                <textarea
                  value={customBrief}
                  disabled={running}
                  onChange={(e) => setCustomBrief(e.target.value)}
                  placeholder="Describe the policy behavior or payment path you want to test."
                  rows={4}
                />
              </label>
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
                  disabled={running}
                  onClick={() => setCustomSteps((rows) => [...rows, newCustomStep("pay_api")])}
                >
                  <Icon name="plus" size={12} /> Add step
                </Button>
              </div>
              {customSteps.map((step, idx) => {
                const meta = CUSTOM_STEP_CATALOG.find((c) => c.kind === step.kind);
                return (
                  <div className="custom-step" key={step.id}>
                    <span className="custom-step-number">{String(idx + 1).padStart(2, "0")}</span>
                    <div className="custom-step-body">
                      <select
                        value={step.kind}
                        disabled={running}
                        onChange={(e) => {
                          const kind = e.target.value as CustomStepKind;
                          const next = newCustomStep(kind);
                          setCustomSteps((rows) =>
                            rows.map((r, i) => (i === idx ? { ...next, id: r.id } : r)),
                          );
                        }}
                      >
                        {CUSTOM_STEP_CATALOG.map((c) => (
                          <option key={c.kind} value={c.kind}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                      <p>{meta?.detail}</p>
                      {(meta?.needsAmount || meta?.needsDestination) && (
                        <div className="custom-step-inputs">
                          {meta.needsAmount && (
                            <input
                              value={step.amount ?? ""}
                              disabled={running}
                              placeholder="Amount"
                              aria-label="Amount"
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
                              disabled={running}
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
                      disabled={running || customSteps.length <= 1}
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
          <span className="lab-kicker">02 · Review the test</span>
          <div className="lab-briefing-title">
            <div>
              <span className={`outcome-pill ${activeMission.expectedOutcome}`}>
                {OUTCOME_LABEL[activeMission.expectedOutcome]}
              </span>
              <h2>{activeMission.title}</h2>
              <p>{activeMission.brief}</p>
            </div>
            {running ? (
              <Button
                variant="destructive"
                onClick={() => {
                  cancelRef.current = true;
                  setToast("Mission cancelled.", "info");
                }}
              >
                Stop run
              </Button>
            ) : (
              <Button disabled={!actor || busy || readOnly} onClick={() => void start()}>
                <Icon name="play" size={14} /> Run scenario
              </Button>
            )}
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
              <i>Estimated cost</i>
              <b>{activeMission.estimatedCost}</b>
            </span>
            <span>
              <Icon name="layers" size={14} />
              <i>Level</i>
              <b>{activeMission.difficulty}</b>
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
                {running
                  ? "Agent is executing"
                  : steps.length
                    ? "Latest run"
                    : "Execution timeline"}
              </h2>
              <p>
                {steps.length
                  ? `${done}/${steps.length} steps complete${blockedStep ? " · waiting for your decision" : ""}`
                  : "Every API call, policy decision, and settlement result will appear here."}
              </p>
            </div>
            {steps.length > 0 && !running && (
              <Button variant="ghost" size="sm" onClick={() => setView("work")}>
                Open deliverable <Icon name="arrowRight" size={12} />
              </Button>
            )}
          </div>

          {blockedStep?.approvalId && (
            <div className="lab-decision-callout">
              <span>
                <Icon name="clock" size={17} />
              </span>
              <div>
                <b>Human decision required</b>
                <p>The agent is parked and cannot spend until you decide.</p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                disabled={busy || readOnly}
                onClick={() => void resolveInline(blockedStep.approvalId!, true)}
              >
                Approve
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={busy || readOnly}
                onClick={() => void resolveInline(blockedStep.approvalId!, false)}
              >
                Deny
              </Button>
            </div>
          )}

          <div className="lab-timeline-body">
            {steps.length === 0 ? (
              <div className="lab-empty-state">
                <span>
                  <Icon name="play" size={22} />
                </span>
                <h3>Ready for a controlled run</h3>
                <p>
                  Select a scenario, review its expected outcome, then run it with{" "}
                  {actor?.name ?? "an agent"}.
                </p>
                <Button disabled={!actor || busy || readOnly} onClick={() => void start()}>
                  <Icon name="play" size={13} /> Start {activeMission.title}
                </Button>
              </div>
            ) : (
              <div className="steps" ref={stepsRef}>
                {steps.map((s, i) => (
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
                      {s.output && (
                        <>
                          <button
                            className="step-toggle"
                            onClick={() => setShownRaw((r) => ({ ...r, [s.id + i]: !r[s.id + i] }))}
                          >
                            {shownRaw[s.id + i] ? "▾ hide API response" : "▸ inspect API response"}
                          </button>
                          {shownRaw[s.id + i] && <div className="out">{s.output}</div>}
                        </>
                      )}
                    </div>
                  </div>
                ))}
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
                <p>Choose intensity and acting agent.</p>
              </div>
            </div>
            <div className="run-mode-grid">
              {RUN_MODES.filter((mode) => !(source === "custom" && mode.id === "smoke_chain")).map(
                (mode) => (
                  <button
                    key={mode.id}
                    className={runMode === mode.id ? "selected" : ""}
                    disabled={running}
                    onClick={() => setRunMode(mode.id)}
                  >
                    <span>{mode.label}</span>
                    <small>{mode.detail}</small>
                  </button>
                ),
              )}
            </div>
            <div className="lab-control-divider" />
            {session.agentKeys.length === 0 ? (
              <>
                <p className="lab-help">
                  Create an agent on Overview, or add an agent key for this browser session.
                </p>
                <div className="lab-add-key">
                  <input
                    type="password"
                    placeholder="pv_agent_…"
                    value={pasteKey}
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
                    value={actorId}
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
