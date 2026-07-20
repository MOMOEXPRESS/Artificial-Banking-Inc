"use client";

import { useCallback, useEffect, useState } from "react";
import { Empty, Icon, fmtUsd } from "./ui";

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

export function PaymentsView({
  gFetch,
  busy,
  act,
  agents,
}: {
  gFetch: (path: string, init?: RequestInit) => Promise<Response>;
  busy: boolean;
  act: (label: string, fn: () => Promise<string | void>) => Promise<void>;
  agents: Agent[];
}) {
  const [rails, setRails] = useState<Rail[]>([]);
  const [subs, setSubs] = useState<Sub[]>([]);
  const [recent, setRecent] = useState<PayRow[]>([]);
  const [tab, setTab] = useState<"recent" | "schedule" | "subs" | "rails">("recent");
  const [form, setForm] = useState({
    agentId: "",
    vendor: "",
    amountUsdc: "",
    runAt: "",
    intervalHours: "24",
  });

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

  return (
    <>
      <div className="card-head" style={{ marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0 }}>Payments</h2>
          <div className="sub">USDC rails, schedules, subscriptions — every charge still hits policy</div>
        </div>
        <div className="seg">
          {(
            [
              ["recent", "Recent"],
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

      {tab === "recent" && (
        <div className="card">
          <div className="card-head">
            <h2>Settled payments</h2>
            <button className="ghost sm" disabled={busy} onClick={() => void refresh()}>
              Refresh
            </button>
          </div>
          {!recent.length ? (
            <Empty icon="zap">No settled pay / pay_api / escrow_lock yet — run a Playground mission.</Empty>
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
                    <td className="mono faint" style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis" }}>
                      {p.destination}
                    </td>
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
                onChange={(e) => setForm({ ...form, vendor: e.target.value })}
                placeholder="api.openai.com"
              />
            </div>
            <div className="field">
              <label>Amount (USDC)</label>
              <input
                value={form.amountUsdc}
                onChange={(e) => setForm({ ...form, amountUsdc: e.target.value })}
                placeholder="5"
              />
            </div>
            <div className="field">
              <label>Run at (local → ISO)</label>
              <input
                type="datetime-local"
                value={form.runAt}
                onChange={(e) => setForm({ ...form, runAt: e.target.value })}
              />
            </div>
          </div>
          <button
            disabled={busy || !form.agentId || !form.vendor.trim() || !form.amountUsdc.trim()}
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
                  onChange={(e) => setForm({ ...form, vendor: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Amount</label>
                <input
                  value={form.amountUsdc}
                  onChange={(e) => setForm({ ...form, amountUsdc: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Every (hours)</label>
                <input
                  value={form.intervalHours}
                  onChange={(e) => setForm({ ...form, intervalHours: e.target.value })}
                />
              </div>
            </div>
            <button
              disabled={busy || !form.agentId || !form.vendor.trim() || !form.amountUsdc.trim()}
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
                          <div className="faint" style={{ fontSize: 10 }}>one-shot</div>
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
                            disabled={busy}
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
                            disabled={busy}
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
                            disabled={busy}
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
              <div className="sub">Extension point: PaymentRail — x402 + transfer-mock wired today</div>
            </div>
            <Icon name="zap" />
          </div>
          {rails.map((r) => (
            <div key={r.id} className="between" style={{ padding: "10px 0", gap: 12 }}>
              <div>
                <b className="mono">{r.id}</b>
                <div className="faint" style={{ fontSize: 12 }}>{r.description}</div>
                <div className="faint" style={{ fontSize: 11 }}>tools: {r.tools.join(", ")}</div>
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
