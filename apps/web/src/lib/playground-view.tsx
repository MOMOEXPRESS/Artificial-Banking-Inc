"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { Empty, Icon, fmtUsd } from "./ui";
import { MISSIONS, runMission, missionsForMode, RUN_MODES, type Mission, type RunMode, type RunStep } from "./mission";
import type { Approval, Session, Shared } from "./console-types";
import type { Policy } from "./policy-view";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "/abi-api";
const SELLER = process.env.NEXT_PUBLIC_SELLER_URL ?? "http://localhost:9402/report";

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
  const [catFilter, setCatFilter] = useState<"all" | Mission["category"]>("all");
  const stepsRef = useRef<HTMLDivElement | null>(null);

  const { missionId, steps, log, running, actorId } = ms;
  const patch = (p: Partial<MissionState>) => setMission((m) => ({ ...m, ...p }));

  useEffect(() => {
    if (!stepsRef.current || steps.length === 0) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const last = stepsRef.current.querySelector(".step:last-child");
    if (last) {
      gsap.fromTo(last, { y: 10, opacity: 0 }, { y: 0, opacity: 1, duration: 0.28, ease: "power2.out" });
    }
  }, [steps]);

  const mission = MISSIONS.find((m) => m.id === missionId) ?? MISSIONS[0];
  const actor = session.agentKeys.find((k) => k.agentId === actorId) ?? session.agentKeys[0];
  const peer = session.agentKeys.find((k) => k.agentId !== actor?.agentId);
  const visibleMissions =
    catFilter === "all" ? MISSIONS : MISSIONS.filter((m) => m.category === catFilter);

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
    const queue = missionsForMode(runMode, missionId);
    try {
      for (let qi = 0; qi < queue.length; qi++) {
        if (cancelRef.current) break;
        const m = queue[qi];
        const runId = `run_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
        setMission((prev) => ({
          ...prev,
          missionId: m.id,
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
          emit: (steps) => setMission((prev) => ({ ...prev, steps })),
          log: (line) =>
            setMission((prev) => ({
              ...prev,
              log: [...prev.log, `${new Date().toLocaleTimeString([], { hour12: false })}  ${line}`],
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
      const res = await fetch(`${API}/v1/agent/budget`, {
        headers: { Authorization: `Bearer ${pasteKey.trim()}` },
      });
      if (!res.ok) throw new Error("That agent key was rejected by the API");
      updateSession({
        agentKeys: [
          ...session.agentKeys,
          { agentId: `manual_${session.agentKeys.length}`, name: "Pasted agent", key: pasteKey.trim() },
        ],
      });
      setPasteKey("");
      return "Agent key added to the Playground.";
    });

  const resolveInline = (approvalId: string, approve: boolean) =>
    act("Approval", async () => {
      const res = await gFetch(`/v1/guardian/approvals/${approvalId}/resolve`, {
        method: "POST",
        body: JSON.stringify({ approve, resolvedBy: "playground" }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(d.error ?? d));
      return approve ? "Approved — watch the agent continue." : "Denied — the agent will replan.";
    });

  const done = steps.filter((s) => s.status === "done").length;

  return (
    <>
      <div className="banner info">
        <span className="ico">
          <Icon name="robot" size={16} />
        </span>
        <span className="txt">
          <b>Test it yourself — no coding required</b>
          <span>
            Pick a mission, hit Run, and watch a real agent spend real balances through the real
            policy engine. Every call below is the same API your production agents would use.
          </span>
        </span>
      </div>

      <div className="grid g-main fill">
        <div className="card" style={{ display: "flex", flexDirection: "column" }}>
          <div className="card-head">
            <div>
              <h2>{running ? "Mission running" : "Mission timeline"}</h2>
              <div className="sub">
                {steps.length
                  ? `${done}/${steps.length} steps complete${blockedStep ? " · parked for your decision" : ""}`
                  : "Select a mission and press Run to begin"}
              </div>
            </div>
            <div className="row">
              {running ? (
                <button
                  className="danger sm"
                  onClick={() => {
                    cancelRef.current = true;
                    setToast("Mission cancelled.", "info");
                  }}
                >
                  Stop
                </button>
              ) : (
                <button className="sm" disabled={!actor || busy || readOnly} onClick={() => void start()}>
                  <Icon name="play" size={13} /> Run mission
                </button>
              )}
            </div>
          </div>

          {blockedStep?.approvalId && (
            <div className="banner" style={{ marginBottom: 14 }}>
              <span className="ico">
                <Icon name="clock" size={16} />
              </span>
              <span className="txt">
                <b>The agent is blocked, waiting on you</b>
                <span>
                  It cannot continue until you decide. Approve or deny right here — or open the
                  Approvals screen.
                </span>
              </span>
              <button className="light sm" disabled={busy || readOnly} onClick={() => void resolveInline(blockedStep.approvalId!, true)}>
                Approve
              </button>
              <button className="danger sm" disabled={busy || readOnly} onClick={() => void resolveInline(blockedStep.approvalId!, false)}>
                Deny
              </button>
            </div>
          )}

          <div style={{ flex: 1, overflowY: "auto", minHeight: 260 }}>
            {steps.length === 0 ? (
              <Empty icon="play">
                Nothing running. Pick a mission on the right — <b>{mission.title}</b> is selected.
              </Empty>
            ) : (
              <div className="steps" ref={stepsRef}>
                {steps.map((s, i) => (
                  <div
                    key={s.id + i}
                    className={`step ${
                      s.status === "done"
                        ? "done"
                        : s.status === "running"
                          ? "run"
                          : s.status === "blocked"
                            ? "block"
                            : s.status === "failed"
                              ? "fail"
                              : ""
                    }`}
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
                            onClick={() =>
                              setShownRaw((r) => ({ ...r, [s.id + i]: !r[s.id + i] }))
                            }
                          >
                            {shownRaw[s.id + i] ? "▾ hide raw response" : "▸ raw response"}
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
          {steps.length > 0 && !running && (
            <>
              <div className="divider" />
              <div className="between">
                <span className="faint" style={{ fontSize: 11.5 }}>
                  Run archived — the deliverable and full step history are in Work &amp; deliverables.
                </span>
                <button className="ghost sm" onClick={() => setView("work")}>
                  Open deliverable <Icon name="arrowRight" size={12} />
                </button>
              </div>
            </>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          <div className="card">
            <div className="card-head">
              <div>
                <h2>Choose a mission</h2>
                <div className="sub">{mission.persona}</div>
              </div>
            </div>
            <div className="seg" style={{ marginBottom: 12, flexWrap: "wrap" }}>
              {(
                [
                  ["all", "All"],
                  ["commerce", "Commerce"],
                  ["governance", "Governance"],
                  ["security", "Security"],
                  ["ops", "Ops"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  className={catFilter === k ? "on" : ""}
                  disabled={running}
                  onClick={() => setCatFilter(k)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {visibleMissions.map((m) => (
                <button
                  key={m.id}
                  className={`mission-card ${m.id === missionId ? "sel" : ""}`}
                  onClick={() => patch({ missionId: m.id })}
                  disabled={running}
                >
                  <b>{m.title}</b>
                  <p>
                    <span className="faint" style={{ display: "block", marginBottom: 4 }}>
                      {m.persona} · {m.category}
                    </span>
                    {m.brief}
                  </p>
                </button>
              ))}
            </div>
            <div className="divider" />
            <div className="card-head" style={{ padding: 0, marginBottom: 8 }}>
              <h2 style={{ fontSize: 14 }}>How to run it</h2>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {RUN_MODES.map((mode) => (
                <button
                  key={mode.id}
                  className={`mission-card ${runMode === mode.id ? "sel" : ""}`}
                  disabled={running}
                  onClick={() => setRunMode(mode.id)}
                >
                  <b>{mode.label}</b>
                  <p>{mode.detail}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Run as</h2>
            </div>
            {session.agentKeys.length === 0 ? (
              <>
                <p className="muted" style={{ fontSize: 12.5, marginTop: 0, lineHeight: 1.6 }}>
                  No agent keys stored yet. Create an agent on the Overview screen — its key is
                  saved here automatically — or paste one below.
                </p>
                <div className="row">
                  <input
                    placeholder="pv_agent_…"
                    value={pasteKey}
                    onChange={(e) => setPasteKey(e.target.value)}
                  />
                  <button className="ghost sm" disabled={!pasteKey.trim() || busy || readOnly} onClick={() => void addKey()}>
                    Add
                  </button>
                </div>
              </>
            ) : (
              <>
                <select
                  value={actorId}
                  onChange={(e) => patch({ actorId: e.target.value })}
                  disabled={running}
                >
                  {session.agentKeys.map((k) => (
                    <option key={k.agentId} value={k.agentId}>
                      {k.name} · {k.key.slice(0, 16)}…
                    </option>
                  ))}
                </select>
                <div className="divider" />
                <div className="between" style={{ fontSize: 12.5 }}>
                  <span className="muted">Approval threshold</span>
                  <b className="mono">{fmtUsd(policy?.hitlAboveUsdc)}</b>
                </div>
                <div className="between" style={{ fontSize: 12.5, marginTop: 8 }}>
                  <span className="muted">Per-payment ceiling</span>
                  <b className="mono">{fmtUsd(policy?.perTxMaxUsdc)}</b>
                </div>
                <div className="between" style={{ fontSize: 12.5, marginTop: 8 }}>
                  <span className="muted">Peer for escrow</span>
                  <b>{peer ? peer.name : "none"}</b>
                </div>
                <div className="divider" />
                <p className="faint" style={{ fontSize: 11.5, margin: 0, lineHeight: 1.6 }}>
                  Tip: run <b>Large purchase</b> to watch the agent park and wait for you, then
                  approve it and see it resume by itself.
                </p>
              </>
            )}
          </div>

          <div className="card" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <div className="card-head">
              <h2>Agent log</h2>
              {pending.length > 0 && (
                <button className="ghost sm" onClick={() => setView("approvals")}>
                  {pending.length} pending <Icon name="arrowRight" size={12} />
                </button>
              )}
            </div>
            <div
              className="code"
              style={{ flex: 1, overflowY: "auto", minHeight: 110, whiteSpace: "pre-wrap" }}
            >
              {log.length ? log.join("\n") : "Waiting for the agent to say something…"}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

