"use client";

import { useCallback, useEffect, useState } from "react";
import { Empty, Icon, fmtUsd, relTime } from "./ui";
import { InvoicesView, type Invoice, type InvoiceStats } from "./views";
import { Approvals } from "./approvals-view";
import type { Approval, OrgView, View } from "./console-types";
import { Button } from "@/components/ui/button";
import { SegTabs } from "@/components/ui/seg-tabs";

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
  onTabChange,
  approvals = [],
  pending = [],
  agentName: agentNameProp,
  setToast,
  setView,
  org = null,
}: {
  gFetch: (path: string, init?: RequestInit) => Promise<Response>;
  busy: boolean;
  act: (label: string, fn: () => Promise<string | void>) => Promise<void>;
  agents: Agent[];
  readOnly?: boolean;
  invoices?: Invoice[];
  invStats?: InvoiceStats | null;
  escrows?: Escrow[];
  initialTab?: "recent" | "schedule" | "subs" | "rails" | "invoices" | "escrows" | "batch" | "approvals";
  onTabChange?: (tab: "approvals" | "recent" | "subs" | "rails" | "invoices" | "escrows" | "batch") => void;
  approvals?: Approval[];
  pending?: Approval[];
  agentName?: (id: string) => string;
  setToast?: (m: string, k?: "ok" | "err" | "info") => void;
  setView?: (v: View, tab?: string) => void;
  org?: OrgView | null;
}) {
  const locked = busy || readOnly;
  const [rails, setRails] = useState<Rail[]>([]);
  const [subs, setSubs] = useState<Sub[]>([]);
  const [recent, setRecent] = useState<PayRow[]>([]);
  const resolveTab = (
    t?: typeof initialTab,
  ): "approvals" | "recent" | "subs" | "rails" | "invoices" | "escrows" | "batch" => {
    if (!t) return pending && pending.length > 0 ? "approvals" : "recent";
    if (t === "schedule") return "subs"; // one-shots live under Scheduled & recurring
    if (t === "batch") return "batch";
    return t;
  };
  const [tab, setTab] = useState<
    "approvals" | "recent" | "subs" | "rails" | "invoices" | "escrows" | "batch"
  >(resolveTab(initialTab));

  useEffect(() => {
    if (initialTab) setTab(resolveTab(initialTab));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTab]);

  const selectTab = (next: typeof tab) => {
    setTab(next);
    onTabChange?.(next);
  };

  const [form, setForm] = useState({
    agentId: "",
    vendor: "",
    amountUsdc: "",
    runAt: "",
    intervalHours: "24",
  });
  const [batchText, setBatchText] = useState(
    "# agentId,vendor,amountUsdc\n# one payment per line, max 10\n",
  );

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

  const agentName = agentNameProp ?? ((id: string) => agents.find((a) => a.id === id)?.name ?? id.slice(0, 8));

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
            Approvals, USDC rails, invoices, escrows — every charge still hits policy
            {readOnly ? " · viewer read-only" : ""}
          </div>
        </div>
        <SegTabs
          value={tab}
          onValueChange={(v) => selectTab(v as typeof tab)}
          items={
            [
              {
                value: "approvals",
                label: pending.length ? `Approvals (${pending.length})` : "Approvals",
              },
              { value: "recent", label: "Recent" },
              { value: "invoices", label: "Invoices" },
              { value: "escrows", label: "Escrows" },
              { value: "subs", label: "Scheduled" },
              { value: "batch", label: "Batch" },
              { value: "rails", label: "Rails" },
            ] as const
          }
        />
      </div>

      {tab === "approvals" && setToast && setView && agentName ? (
        <Approvals
          gFetch={gFetch}
          busy={busy}
          act={act}
          setToast={setToast}
          setView={setView}
          readOnly={readOnly}
          org={org ?? null}
          approvals={approvals}
          pending={pending}
          agentName={agentName}
        />
      ) : null}

      {tab === "batch" && (
        <div className="card fill">
          <div className="card-head">
            <div>
              <h2>Batch payments</h2>
              <div className="sub">
                Up to 10 one-shot schedules — each line still hits policy alone. Format:{" "}
                <code>agentId,vendor,amountUsdc</code>
              </div>
            </div>
          </div>
          <textarea
            value={batchText}
            disabled={readOnly}
            onChange={(e) => setBatchText(e.target.value)}
            rows={8}
            style={{ width: "100%", fontFamily: "var(--font-mono, monospace)", fontSize: 12 }}
          />
          <div className="row" style={{ marginTop: 12, gap: 8 }}>
            <Button size="sm"
              disabled={locked}
              onClick={() =>
                void act("Batch enqueue", async () => {
                  const items = batchText
                    .split("\n")
                    .map((l) => l.trim())
                    .filter((l) => l && !l.startsWith("#"))
                    .slice(0, 10)
                    .map((line) => {
                      const [agentId, vendor, amountUsdc] = line.split(",").map((s) => s.trim());
                      if (!agentId || !vendor || !amountUsdc) {
                        throw new Error(`Bad line: ${line}`);
                      }
                      return { agentId, vendor, amountUsdc };
                    });
                  if (!items.length) throw new Error("No batch items");
                  const res = await gFetch("/v1/guardian/payments/batch", {
                    method: "POST",
                    body: JSON.stringify({ items }),
                  });
                  const d = await res.json();
                  if (!res.ok) throw new Error(d.error?.message ?? JSON.stringify(d));
                  await refresh();
                  return `Enqueued ${d.created?.length ?? 0} · errors ${d.errors?.length ?? 0}`;
                })
              }
            >
              Enqueue batch
            </Button>
            <Button variant="ghost" size="sm"
              disabled={readOnly || !agents[0]}
              onClick={() => {
                const a = agents[0]!;
                setBatchText(
                  `# agentId,vendor,amountUsdc\n${a.id},https://api.example.com/v1,1.00\n`,
                );
              }}
            >
              Prefill sample
            </Button>
          </div>
        </div>
      )}

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
                            <Button size="sm"
                              disabled={locked}
                              onClick={() => void resolveEscrow(e.id, "release")}
                            >
                              Release
                            </Button>
                            <Button variant="destructive" size="sm"
                              disabled={locked}
                              onClick={() => void resolveEscrow(e.id, "refund")}
                            >
                              Refund
                            </Button>
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
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void refresh()}>
              Refresh
            </Button>
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

      {tab === "subs" && (
        <>
          <div className="card">
            <div className="card-head">
              <div>
                <h2>Schedule one-shot</h2>
                <div className="sub">
                  Runs once through policy at the chosen time. If policy returns review, the charge
                  parks in Approvals — same as live pay.
                </div>
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
                  return `Scheduled ${fmtUsd(d.scheduled.amountUsdc)} for ${runAt}.`;
                })
              }
            >
              Schedule
            </button>
          </div>

          <div className="card">
            <div className="card-head">
              <div>
                <h2>New subscription</h2>
                <div className="sub">
                  Recurring charge — every run is still policy-gated. Review outcomes park in
                  Approvals.
                </div>
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
                          <Button variant="ghost" size="sm"
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
                          </Button>
                        )}
                        {s.status === "paused" && (
                          <Button variant="ghost" size="sm"
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
                          </Button>
                        )}
                        {s.status !== "cancelled" && (
                          <Button variant="ghost" size="sm"
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
                          </Button>
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
                How money actually leaves an agent wallet. <b>x402</b> is pay-per-API (HTTP 402 +
                EIP-712). <b>transfer-mock</b> is the local USDC transfer rail for addresses /
                non-URL destinations. Live CDP settlement plugs in behind the same PaymentRail
                interface — you do not change agent code.
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
