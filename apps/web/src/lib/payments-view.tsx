"use client";

import { useCallback, useEffect, useState } from "react";
import { Empty, Icon, fmtUsd, relTime } from "./ui";
import { InvoicesView, type Invoice, type InvoiceStats } from "./views";

type Agent = { id: string; name: string; status: string };
type Rail = { id: string; tools: string[]; description: string; status: string };
type Sub = {
  id: string;
  agentId: string;
  vendor: string;
  amountUsdc: string;
  intervalHours: number;
  status: string;
  runs: number;
  spentUsdc: string;
  nextRunAt: string;
  memo?: string;
  lastError?: string;
};
type PayRow = {
  at: string;
  tool: string;
  amountUsdc: string;
  destination: string;
  agentName: string;
  outcome: string;
};

type Escrow = {
  id: string;
  payerAgentId: string;
  payeeAgentId: string;
  amountUsdc: string;
  state: string;
  jobId?: string;
  memo?: string;
  timeoutAt: string;
};

export function PaymentsView({
  gFetch,
  busy,
  act,
  agents,
  readOnly = false,
  invoices = [],
  invStats = null,
  escrows = [],
  initialTab,
}: {
  gFetch: (path: string, init?: RequestInit) => Promise<Response>;
  busy: boolean;
  act: (label: string, fn: () => Promise<string | void>) => Promise<void>;
  agents: Agent[];
  readOnly?: boolean;
  invoices?: Invoice[];
  invStats?: InvoiceStats | null;
  escrows?: Escrow[];
  initialTab?: "recent" | "schedule" | "subs" | "rails" | "invoices" | "escrows";
}) {
  const locked = busy || readOnly;
  const [rails, setRails] = useState<Rail[]>([]);
  const [subs, setSubs] = useState<Sub[]>([]);
  const [recent, setRecent] = useState<PayRow[]>([]);
  const [tab, setTab] = useState<
    "recent" | "schedule" | "subs" | "rails" | "invoices" | "escrows"
  >(initialTab ?? "recent");
  const [form, setForm] = useState({
    agentId: "",
    vendor: "",
    amountUsdc: "",
    runAt: "",
    intervalHours: "24",
  });

  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab]);

  const refresh = useCallback(async () => {
    const [r, s, p] = await Promise.all([
      gFetch("/v1/guardian/payments/rails").then((x) => x.json()),
      gFetch("/v1/guardian/subscriptions").then((x) => x.json()),
      gFetch("/v1/guardian/payments/recent").then((x) => x.json()),
    ]);
    setRails(r.rails ?? []);
    setSubs(s.subscriptions ?? []);
    setRecent(p.payments ?? []);
  }, [gFetch]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!form.agentId && agents[0]) setForm((f) => ({ ...f, agentId: agents[0].id }));
  }, [agents, form.agentId]);

  const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? id.slice(0, 8);

  const resolveEscrow = (id: string, action: "release" | "refund") =>
    act("Escrow", async () => {
      const res = await gFetch(`/v1/guardian/escrows/${id}/resolve`, {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error?.message ?? JSON.stringify(d));
      return `Escrow ${action === "release" ? "released to the payee" : "refunded to the payer"}.`;
    });

  const escrowTone = (state: string) => {
    if (state === "locked") return "warn";
    if (state === "settling") return "info";
    if (state === "released") return "ok";
    return "mute";
  };

  return (
    <>
      <div className="card-head" style={{ marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0 }}>Payments</h2>
          <div className="sub">
            USDC rails, invoices, escrows, schedules — every charge still hits policy
            {readOnly ? " · viewer read-only" : ""}
          </div>
        </div>
        <div className="seg">
          {(
            [
              ["recent", "Recent"],
              ["invoices", "Invoices"],
              ["escrows", "Escrows"],
              ["schedule", "Schedule"],
              ["subs", "Subscriptions"],
              ["rails", "Rails"],
            ] as const
          ).map(([k, label]) => (
            <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === "invoices" && (
        <InvoicesView
          invoices={invoices}
          stats={invStats}
          busy={busy}
          act={act}
          gFetch={gFetch}
          readOnly={readOnly}
        />
      )}

      {tab === "escrows" && (
        <div className="card fill" style={{ display: "flex", flexDirection: "column" }}>
          <div className="card-head">
            <div>
              <h2>Agent-to-agent escrow</h2>
              <div className="sub">
                Funds lock when one agent hires another and only move on acceptance — or refund
                automatically at timeout.
              </div>
            </div>
          </div>
          {escrows.length === 0 ? (
            <Empty icon="swap">
              No escrows yet. Run the <b>Research brief</b> mission in the Playground — the agent
              hires a peer and locks funds.
            </Empty>
          ) : (
            <div className="tbl-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Payer</th>
                    <th>Payee</th>
                    <th className="num">Amount</th>
                    <th>State</th>
                    <th>Job</th>
                    <th>Auto-refund</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {escrows.map((e) => (
                    <tr key={e.id}>
                      <td>{agentName(e.payerAgentId)}</td>
                      <td>{agentName(e.payeeAgentId)}</td>
                      <td className="num mono">{fmtUsd(e.amountUsdc)}</td>
                      <td>
                        <span className={`pill ${escrowTone(e.state)}`}>
                          <i /> {e.state}
                        </span>
                      </td>
                      <td className="muted wrap">{e.memo ?? e.jobId ?? "—"}</td>
                      <td className="mono faint">
                        {e.state === "locked" ? relTime(e.timeoutAt) : "—"}
                      </td>
                      <td>
                        {e.state === "locked" ? (
                          <div className="row" style={{ flexWrap: "nowrap" }}>
                            <button
                              className="sm"
                              disabled={locked}
                              onClick={() => void resolveEscrow(e.id, "release")}
                            >
                              Release
                            </button>
                            <button
                              className="danger sm"
                              disabled={locked}
                              onClick={() => void resolveEscrow(e.id, "refund")}
                            >
                              Refund
                            </button>
                          </div>
                        ) : e.state === "settling" ? (
                          <span className="faint">settling…</span>
                        ) : (
                          <span className="faint">settled</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "recent" && (
        <div className="card">
          <div className="card-head">
            <h2>Settled payments</h2>
            <button className="ghost sm" disabled={busy} onClick={() => void refresh()}>
              Refresh
            </button>
          </div>
          {!recent.length ? (
            <Empty icon="zap">
              No settled pay / pay_api / escrow_lock yet — run a Playground mission.
            </Empty>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Agent</th>
                  <th>Tool</th>
                  <th>Destination</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((p, i) => (
                  <tr key={`${p.at}-${i}`}>
                    <td className="mono faint" style={{ fontSize: 11 }}>
                      {new Date(p.at).toLocaleString()}
                    </td>
                    <td>{p.agentName}</td>
                    <td className="mono">{p.tool}</td>
                    <td className="mono wrap">{p.destination}</td>
                    <td className="num mono">{fmtUsd(p.amountUsdc)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "schedule" && (
        <div className="card">
          <div className="card-head">
            <div>
              <h2>Schedule one-shot</h2>
              <div className="sub">Runs once through policy at the chosen time, then stops.</div>
            </div>
          </div>
          <div className="grid g-2" style={{ gap: "0 14px" }}>
            <div className="field">
              <label>Agent</label>
              <select
                value={form.agentId}
                disabled={readOnly}
                onChange={(e) => setForm({ ...form, agentId: e.target.value })}
              >
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Vendor / destination</label>
              <input
                value={form.vendor}
                disabled={readOnly}
                onChange={(e) => setForm({ ...form, vendor: e.target.value })}
                placeholder="api.openai.com"
              />
            </div>
            <div className="field">
              <label>Amount (USDC)</label>
              <input
                value={form.amountUsdc}
                disabled={readOnly}
                onChange={(e) => setForm({ ...form, amountUsdc: e.target.value })}
                placeholder="5"
              />
            </div>
            <div className="field">
              <label>Run at (local → ISO)</label>
              <input
                type="datetime-local"
                value={form.runAt}
                disabled={readOnly}
                onChange={(e) => setForm({ ...form, runAt: e.target.value })}
              />
            </div>
          </div>
          <button
            disabled={locked || !form.agentId || !form.vendor.trim() || !form.amountUsdc.trim()}
            onClick={() =>
              void act("Schedule payment", async () => {
                const runAt = form.runAt
                  ? new Date(form.runAt).toISOString()
                  : new Date(Date.now() + 60_000).toISOString();
                const res = await gFetch("/v1/guardian/payments/schedule", {
                  method: "POST",
                  body: JSON.stringify({
                    agentId: form.agentId,
                    vendor: form.vendor.trim(),
                    amountUsdc: form.amountUsdc.trim(),
                    runAt,
                  }),
                });
                const d = await res.json();
                if (!res.ok) throw new Error(d.error?.message ?? JSON.stringify(d.error));
                setForm((f) => ({ ...f, amountUsdc: "", vendor: "" }));
                await refresh();
                setTab("subs");
                return `Scheduled ${fmtUsd(d.scheduled.amountUsdc)} for ${runAt}.`;
              })
            }
          >
            Schedule
          </button>
        </div>
      )}

      {tab === "subs" && (
        <>
          <div className="card">
            <div className="card-head">
              <div>
                <h2>New subscription</h2>
                <div className="sub">Recurring charge — every run is still policy-gated.</div>
              </div>
            </div>
            <div className="grid g-2" style={{ gap: "0 14px" }}>
              <div className="field">
                <label>Agent</label>
                <select
                  value={form.agentId}
                  disabled={readOnly}
                  onChange={(e) => setForm({ ...form, agentId: e.target.value })}
                >
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Vendor</label>
                <input
                  value={form.vendor}
                  disabled={readOnly}
                  onChange={(e) => setForm({ ...form, vendor: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Amount</label>
                <input
                  value={form.amountUsdc}
                  disabled={readOnly}
                  onChange={(e) => setForm({ ...form, amountUsdc: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Every (hours)</label>
                <input
                  value={form.intervalHours}
                  disabled={readOnly}
                  onChange={(e) => setForm({ ...form, intervalHours: e.target.value })}
                />
              </div>
            </div>
            <button
              disabled={locked || !form.agentId || !form.vendor.trim() || !form.amountUsdc.trim()}
              onClick={() =>
                void act("Create subscription", async () => {
                  const res = await gFetch("/v1/guardian/subscriptions", {
                    method: "POST",
                    body: JSON.stringify({
                      agentId: form.agentId,
                      vendor: form.vendor.trim(),
                      amountUsdc: form.amountUsdc.trim(),
                      intervalHours: Number(form.intervalHours) || 24,
                    }),
                  });
                  const d = await res.json();
                  if (!res.ok) throw new Error(d.error?.message ?? JSON.stringify(d.error));
                  await refresh();
                  return "Subscription created.";
                })
              }
            >
              Create subscription
            </button>
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Active & scheduled</h2>
            </div>
            {!subs.length ? (
              <Empty icon="clock">No subscriptions or schedules yet.</Empty>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Vendor</th>
                    <th>Agent</th>
                    <th className="num">Amount</th>
                    <th>Next</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {subs.map((s) => (
                    <tr key={s.id}>
                      <td className="mono">
                        {s.vendor}
                        {s.memo?.includes("scheduled") || s.memo?.startsWith("batch_") ? (
                          <div className="faint" style={{ fontSize: 10 }}>
                            one-shot
                          </div>
                        ) : null}
                      </td>
                      <td>{agentName(s.agentId)}</td>
                      <td className="num mono">{fmtUsd(s.amountUsdc)}</td>
                      <td className="mono faint" style={{ fontSize: 11 }}>
                        {new Date(s.nextRunAt).toLocaleString()}
                      </td>
                      <td>
                        <span
                          className={`pill ${
                            s.status === "active" ? "ok" : s.status === "paused" ? "warn" : "mute"
                          }`}
                        >
                          <i /> {s.status}
                        </span>
                      </td>
                      <td>
                        {s.status === "active" && (
                          <button
                            className="ghost sm"
                            disabled={locked}
                            onClick={() =>
                              void act("Pause", async () => {
                                await gFetch(`/v1/guardian/subscriptions/${s.id}/pause`, {
                                  method: "POST",
                                });
                                await refresh();
                              })
                            }
                          >
                            Pause
                          </button>
                        )}
                        {s.status === "paused" && (
                          <button
                            className="ghost sm"
                            disabled={locked}
                            onClick={() =>
                              void act("Resume", async () => {
                                await gFetch(`/v1/guardian/subscriptions/${s.id}/resume`, {
                                  method: "POST",
                                });
                                await refresh();
                              })
                            }
                          >
                            Resume
                          </button>
                        )}
                        {s.status !== "cancelled" && (
                          <button
                            className="ghost sm"
                            disabled={locked}
                            onClick={() =>
                              void act("Cancel", async () => {
                                await gFetch(`/v1/guardian/subscriptions/${s.id}/cancel`, {
                                  method: "POST",
                                });
                                await refresh();
                              })
                            }
                          >
                            Cancel
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {tab === "rails" && (
        <div className="card">
          <div className="card-head">
            <div>
              <h2>Settlement rails</h2>
              <div className="sub">
                Extension point: PaymentRail — x402 + transfer-mock wired today
              </div>
            </div>
            <Icon name="zap" />
          </div>
          {rails.map((r) => (
            <div key={r.id} className="between" style={{ padding: "10px 0", gap: 12 }}>
              <div>
                <b className="mono">{r.id}</b>
                <div className="faint" style={{ fontSize: 12 }}>
                  {r.description}
                </div>
                <div className="faint" style={{ fontSize: 11 }}>
                  tools: {r.tools.join(", ")}
                </div>
              </div>
              <span className={`pill ${r.status === "live" ? "ok" : "mute"}`}>
                <i /> {r.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
