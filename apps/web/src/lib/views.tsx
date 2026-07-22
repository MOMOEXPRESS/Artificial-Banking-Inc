"use client";

import { useEffect, useMemo, useState } from "react";
import { Empty, Icon, Meter, Stat, fmtDate, fmtTime, fmtUsd, relTime } from "./ui";
import { viewLabel } from "./console-types";
import { Button } from "@/components/ui/button";

/* ============================================================ markdown */

/** Small dependency-free renderer for the deliverable documents agents produce. */
export function Markdown({ src }: { src: string }) {
  const blocks = useMemo(() => parseMarkdown(src), [src]);
  return <div className="doc">{blocks}</div>;
}

function inline(text: string, key: string) {
  const parts: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|_[^_]+_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("**")) parts.push(<strong key={`${key}b${i}`}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith("`")) parts.push(<code key={`${key}c${i}`}>{t.slice(1, -1)}</code>);
    else parts.push(<em key={`${key}e${i}`}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
    i++;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function parseMarkdown(src: string): React.ReactNode[] {
  const lines = src.split("\n");
  const out: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith("# ")) {
      out.push(<h1 key={key++}>{inline(line.slice(2), `h${key}`)}</h1>);
      i++;
      continue;
    }
    if (line.startsWith("## ")) {
      out.push(<h2 key={key++}>{inline(line.slice(3), `h${key}`)}</h2>);
      i++;
      continue;
    }
    // table
    if (line.trim().startsWith("|") && lines[i + 1]?.includes("---")) {
      const head = line.split("|").slice(1, -1).map((c) => c.trim());
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rows.push(lines[i].split("|").slice(1, -1).map((c) => c.trim()));
        i++;
      }
      out.push(
        <div className="tbl-wrap" key={key++}>
          <table>
            <thead>
              <tr>
                {head.map((h, hi) => (
                  <th key={hi} className={hi > 0 ? "num" : ""}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, ci) => (
                    <td key={ci} className={ci > 0 ? "num" : ""}>
                      {inline(c, `t${ri}${ci}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    // list
    if (line.trim().startsWith("- ")) {
      const items: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("- ")) {
        items.push(lines[i].trim().slice(2));
        i++;
      }
      out.push(
        <ul key={key++}>
          {items.map((it, ii) => (
            <li key={ii}>{inline(it, `l${ii}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }
    // paragraph
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^[#|\-]/.test(lines[i].trim())) {
      para.push(lines[i]);
      i++;
    }
    if (para.length) out.push(<p key={key++}>{inline(para.join(" "), `p${key}`)}</p>);
    else i++;
  }
  return out;
}

/* ============================================================ AI panel */

export type Summary = {
  headline: string;
  body: string;
  highlights: { label: string; value: string; tone: string; hint: string }[];
  generatedAt: string;
};

const SUGGESTIONS = [
  "How much did we spend today?",
  "What got blocked?",
  "Who did we pay?",
  "Are the books clean?",
];

export function AIPanel({
  summary,
  gFetch,
  onGoto,
}: {
  summary: Summary | null;
  gFetch: (p: string, i?: RequestInit) => Promise<Response>;
  onGoto: (view: string) => void;
}) {
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<{ answer: string; goto?: string } | null>(null);
  const [thinking, setThinking] = useState(false);
  const [expanded, setExpanded] = useState(false);

  async function ask(question: string) {
    if (!question.trim()) return;
    setThinking(true);
    setAnswer(null);
    try {
      const res = await gFetch("/v1/guardian/ask", {
        method: "POST",
        body: JSON.stringify({ question }),
      });
      setAnswer(await res.json());
    } catch (e) {
      setAnswer({ answer: `Could not reach the API: ${String(e)}` });
    } finally {
      setThinking(false);
      // Only clear if the box still holds what was submitted — otherwise a
      // follow-up typed while the answer loaded gets wiped.
      setQ((cur) => (cur === question ? "" : cur));
    }
  }

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column" }}>
      <div className="ai-head">
        <span className="ai-spark">
          <Icon name="spark" size={15} />
        </span>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ fontSize: 16, fontWeight: 620, margin: 0 }}>How can I help you?</h2>
          <div className="faint" style={{ fontSize: 11.5 }}>
            {summary ? summary.headline : "reading your ledger…"}
          </div>
        </div>
      </div>

      <div style={{ fontSize: 11.5, fontWeight: 650, color: "var(--muted)", marginTop: 14 }}>
        SUMMARY
      </div>
      <p className={`ai-body ${expanded ? "" : "clamp"}`}>
        {summary?.body ?? "Gathering activity from your ledger, decisions and invoices…"}
      </p>
      {summary && summary.body.length > 220 && (
        <button className="ai-more" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Show less" : "Read more"}
        </button>
      )}

      <div className="ai-chips">
        {(summary?.highlights ?? []).slice(0, 4).map((h) => (
          <div className="ai-chip" key={h.label}>
            <div className="k">{h.label}</div>
            <div className="v">
              {h.value}
              <span className={`pill ${h.tone === "bad" ? "bad" : h.tone === "warn" ? "warn" : h.tone === "ok" ? "ok" : "mute"}`}>
                {h.tone === "warn" ? "check" : h.tone === "bad" ? "act" : h.tone === "ok" ? "good" : "info"}
              </span>
            </div>
            <div className="h">{h.hint}</div>
          </div>
        ))}
      </div>

      {answer && (
        <div className="ask-answer">
          {answer.answer}
          {answer.goto && (
            <div style={{ marginTop: 9 }}>
              <Button variant="ghost" size="sm" onClick={() => onGoto(answer.goto!)}>
                Open {viewLabel(answer.goto!)} <Icon name="arrowRight" size={12} />
              </Button>
            </div>
          )}
        </div>
      )}

      {thinking && (
        <div className="thinking" style={{ marginTop: 12 }}>
          <span className="bar" /> reading your ledger…
        </div>
      )}

      <div className="suggest">
        {SUGGESTIONS.map((s) => (
          <button key={s} onClick={() => void ask(s)} disabled={thinking}>
            {s}
          </button>
        ))}
      </div>

      <div className="ask">
        <input
          placeholder="Ask me anything about your agents…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void ask(q)}
        />
        <button onClick={() => void ask(q)} disabled={thinking || !q.trim()} aria-label="Ask">
          <Icon name="send" />
        </button>
      </div>
    </div>
  );
}

/* ============================================================= invoices */

export type Invoice = {
  id: string;
  number: string;
  counterparty: string;
  amountUsdc: string;
  status: string;
  issuedAt: string;
  dueAt: string;
  paidAt?: string;
  memo?: string;
  runId?: string;
};

export type InvoiceStats = {
  paidUsdc: string;
  outstandingUsdc: string;
  overdueCount: number;
  paymentScore: number;
};

export function InvoicesView({
  invoices,
  stats,
  busy,
  act,
  gFetch,
  readOnly = false,
}: {
  invoices: Invoice[];
  stats: InvoiceStats | null;
  busy: boolean;
  act: (label: string, fn: () => Promise<string | void>) => Promise<void>;
  gFetch: (p: string, i?: RequestInit) => Promise<Response>;
  readOnly?: boolean;
}) {
  const locked = busy || readOnly;
  const [form, setForm] = useState({ counterparty: "", amountUsdc: "", dueInDays: "14", memo: "" });
  const [open, setOpen] = useState(false);

  const create = () =>
    act("Invoice", async () => {
      const res = await gFetch("/v1/guardian/invoices", {
        method: "POST",
        body: JSON.stringify({
          counterparty: form.counterparty.trim(),
          amountUsdc: form.amountUsdc.trim(),
          dueInDays: Number(form.dueInDays) || 14,
          memo: form.memo.trim() || undefined,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error?.message ?? JSON.stringify(d));
      setForm({ counterparty: "", amountUsdc: "", dueInDays: "14", memo: "" });
      setOpen(false);
      return `Invoice ${d.invoice.number} raised for ${fmtUsd(d.invoice.amountUsdc)}.`;
    });

  const pay = (id: string) =>
    act("Settle", async () => {
      const res = await gFetch(`/v1/guardian/invoices/${id}/pay`, { method: "POST" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error?.message ?? JSON.stringify(d));
      return `Settled — cash booked into the treasury and recognised as revenue.`;
    });

  const voidIt = (id: string) =>
    act("Void", async () => {
      const res = await gFetch(`/v1/guardian/invoices/${id}/void`, { method: "POST" });
      if (!res.ok) throw new Error(JSON.stringify(await res.json()));
      return "Invoice voided.";
    });

  const statusTone = (s: string) =>
    s === "paid" ? "ok" : s === "overdue" ? "bad" : s === "void" ? "mute" : "warn";

  return (
    <>
      <div className="grid g-4">
        <Stat label="Collected" value={fmtUsd(stats?.paidUsdc)} foot="booked as revenue" />
        <Stat
          label="Outstanding"
          value={fmtUsd(stats?.outstandingUsdc)}
          foot={`${invoices.filter((i) => i.status === "sent").length} awaiting payment`}
        />
        <Stat
          label="Overdue"
          value={String(stats?.overdueCount ?? 0)}
          foot="past their due date"
          delta={stats?.overdueCount ? { dir: "down", text: "chase" } : { dir: "up", text: "none" }}
        />
        <Stat label="Invoices" value={String(invoices.length)} foot="raised for agent work" />
      </div>

      <div className="grid g-main fill">
        <div className="card" style={{ display: "flex", flexDirection: "column" }}>
          <div className="card-head">
            <div>
              <h2>Invoices</h2>
              <div className="sub">
                Bill clients for the work your agents produced. Settling one books the cash into
                the treasury as revenue.
              </div>
            </div>
            <Button size="sm" disabled={readOnly} onClick={() => setOpen((v) => !v)}>
              <Icon name="plus" size={13} /> New invoice
            </Button>
          </div>

          {open && (
            <div
              className="card tight"
              style={{ background: "var(--surface-3)", marginBottom: 14 }}
            >
              <div className="grid g-2" style={{ gap: "0 14px" }}>
                <div className="field">
                  <label>Client</label>
                  <input
                    placeholder="Acme Corp"
                    value={form.counterparty}
                    onChange={(e) => setForm({ ...form, counterparty: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>Amount (USDC)</label>
                  <input
                    placeholder="250"
                    value={form.amountUsdc}
                    onChange={(e) => setForm({ ...form, amountUsdc: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>Due in (days)</label>
                  <input
                    value={form.dueInDays}
                    onChange={(e) => setForm({ ...form, dueInDays: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>For</label>
                  <input
                    placeholder="Competitor pricing brief"
                    value={form.memo}
                    onChange={(e) => setForm({ ...form, memo: e.target.value })}
                  />
                </div>
              </div>
              <div className="row">
                <button
                  disabled={locked || !form.counterparty.trim() || !form.amountUsdc.trim()}
                  onClick={() => void create()}
                >
                  Raise invoice
                </button>
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {invoices.length === 0 ? (
            <Empty icon="book">
              No invoices yet. Raise one to bill a client for work your agents delivered — that is
              the income side of the agent P&amp;L.
            </Empty>
          ) : (
            <div style={{ flex: 1 }}>
              {invoices.map((inv) => (
                <div className="inv-row" key={inv.id}>
                  <div className="inv-when">
                    <b>{fmtDate(inv.issuedAt)}</b>
                    <span>
                      {inv.status === "paid"
                        ? `paid ${relTime(inv.paidAt ?? inv.issuedAt)}`
                        : `due ${relTime(inv.dueAt)}`}
                    </span>
                  </div>
                  <span className={`pill ${statusTone(inv.status)}`}>
                    <i /> {inv.status}
                  </span>
                  <div className="inv-who">
                    <b>{inv.counterparty}</b>
                    <span>
                      {inv.number}
                      {inv.memo ? ` · ${inv.memo}` : ""}
                    </span>
                  </div>
                  <div className="inv-amt">{fmtUsd(inv.amountUsdc)}</div>
                  {inv.status !== "paid" && inv.status !== "void" ? (
                    <div className="row" style={{ flexWrap: "nowrap" }}>
                      <Button size="sm" disabled={locked} onClick={() => void pay(inv.id)}>
                        Mark paid
                      </Button>
                      <Button variant="ghost" size="sm" disabled={locked} onClick={() => void voidIt(inv.id)}>
                        Void
                      </Button>
                    </div>
                  ) : (
                    <span className="faint" style={{ fontSize: 11.5, minWidth: 78, textAlign: "right" }}>
                      {inv.status === "paid" ? "settled" : "voided"}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          <div className="card">
            <div className="card-head">
              <h2>Payment score</h2>
            </div>
            <div className="row" style={{ gap: 12, flexWrap: "nowrap" }}>
              <Meter score={stats?.paymentScore ?? 0} />
              <b style={{ fontSize: 20, fontVariantNumeric: "tabular-nums" }}>
                {stats?.paymentScore ?? 0}
              </b>
            </div>
            <p className="faint" style={{ fontSize: 11.5, marginTop: 12, lineHeight: 1.6 }}>
              How reliably your clients settle: the share of invoices paid on time, penalised for
              each one currently overdue.
            </p>
          </div>

          <div className="card" style={{ flex: 1 }}>
            <div className="card-head">
              <h2>Why invoices matter</h2>
            </div>
            <p className="muted" style={{ fontSize: 12.5, marginTop: 0, lineHeight: 1.7 }}>
              Agents cost money to run — API calls, compute, hiring peers. Invoicing closes the
              loop so you can see whether a swarm actually earns more than it burns.
            </p>
            <div className="divider" />
            <div className="between" style={{ fontSize: 12.5, marginBottom: 9 }}>
              <span className="muted">Collected</span>
              <b className="mono" style={{ color: "var(--green)" }}>
                {fmtUsd(stats?.paidUsdc)}
              </b>
            </div>
            <div className="between" style={{ fontSize: 12.5 }}>
              <span className="muted">Still owed</span>
              <b className="mono" style={{ color: "var(--warn)" }}>
                {fmtUsd(stats?.outstandingUsdc)}
              </b>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/* ================================================================= work */

export type Run = {
  id: string;
  missionId: string;
  title: string;
  agentName?: string;
  status: string;
  startedAt: string;
  finishedAt?: string;
  costUsdc: string;
  steps: { id: string; title: string; status: string; summary?: string; output?: string }[];
  deliverableMd?: string;
};

export function WorkView({
  runs,
  busy,
  act,
  gFetch,
}: {
  runs: Run[];
  busy: boolean;
  act: (label: string, fn: () => Promise<string | void>) => Promise<void>;
  gFetch: (p: string, i?: RequestInit) => Promise<Response>;
}) {
  const [selId, setSelId] = useState<string | null>(null);
  const sel = runs.find((r) => r.id === selId) ?? runs[0];

  useEffect(() => {
    if (!selId && runs[0]) setSelId(runs[0].id);
  }, [runs, selId]);

  const totalCost = runs.reduce((a, r) => a + Number(r.costUsdc), 0);
  const withDeliverable = runs.filter((r) => r.deliverableMd);

  function download(run: Run) {
    const blob = new Blob([run.deliverableMd ?? ""], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${run.missionId}-${run.id}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const bill = (run: Run) =>
    act("Invoice", async () => {
      const res = await gFetch("/v1/guardian/invoices", {
        method: "POST",
        body: JSON.stringify({
          counterparty: "Client",
          amountUsdc: (Math.max(Number(run.costUsdc), 1) * 4).toFixed(2),
          dueInDays: 14,
          memo: run.title,
          runId: run.id,
        }),
      });
      if (!res.ok) throw new Error(JSON.stringify(await res.json()));
      return "Invoice raised for this deliverable at a 4× cost markup — edit it in Invoices.";
    });

  return (
    <>
      <div className="grid g-4">
        <Stat label="Runs" value={String(runs.length)} foot="missions executed" />
        <Stat label="Deliverables" value={String(withDeliverable.length)} foot="documents produced" />
        <Stat label="Total cost" value={fmtUsd(totalCost)} foot="what the work consumed" />
        <Stat
          label="Avg per run"
          value={fmtUsd(runs.length ? totalCost / runs.length : 0)}
          foot="cost per deliverable"
        />
      </div>

      <div className="grid g-main fill">
        <div className="card" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          {!sel ? (
            <Empty icon="book">
              No work yet. Run a mission in the Agent Playground — the deliverable it produces
              lands here.
            </Empty>
          ) : (
            <>
              <div className="card-head">
                <div style={{ minWidth: 0 }}>
                  <h2>{sel.title}</h2>
                  <div className="sub">
                    {sel.agentName ?? "agent"} · {fmtDate(sel.startedAt)} {fmtTime(sel.startedAt)} ·
                    cost {fmtUsd(sel.costUsdc)}
                  </div>
                </div>
                <div className="row">
                  {sel.deliverableMd && (
                    <>
                      <Button variant="ghost" size="sm" onClick={() => download(sel)}>
                        <Icon name="download" size={13} /> Markdown
                      </Button>
                      <Button size="sm" disabled={busy} onClick={() => void bill(sel)}>
                        Bill this work
                      </Button>
                    </>
                  )}
                </div>
              </div>

              <div style={{ overflowY: "auto", flex: 1, minHeight: 0, paddingRight: 4 }}>
                {sel.deliverableMd ? (
                  <Markdown src={sel.deliverableMd} />
                ) : (
                  <div className="muted" style={{ fontSize: 13 }}>
                    {sel.status === "running"
                      ? "This run is still in flight — the deliverable appears when it finishes."
                      : "This run produced no document."}
                  </div>
                )}

                <div className="divider" />
                <h2 style={{ fontSize: 14, margin: "0 0 12px" }}>How it was produced</h2>
                <div className="steps">
                  {sel.steps.map((s, i) => (
                    <div
                      key={s.id + i}
                      className={`step ${
                        s.status === "done" ? "done" : s.status === "failed" ? "fail" : s.status === "blocked" ? "block" : ""
                      }`}
                    >
                      <div className="bullet">
                        {s.status === "done" ? (
                          <Icon name="check" size={13} />
                        ) : s.status === "failed" ? (
                          <Icon name="x" size={13} />
                        ) : (
                          i + 1
                        )}
                      </div>
                      <div className="sbody">
                        <b>{s.title}</b>
                        {s.summary && <p className="sum">{s.summary}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="card" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div className="card-head">
            <h2>Archive</h2>
          </div>
          {runs.length === 0 ? (
            <Empty icon="list">Nothing archived yet.</Empty>
          ) : (
            <div style={{ overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
              {runs.map((r) => (
                <button
                  key={r.id}
                  className={`mission-card ${r.id === sel?.id ? "sel" : ""}`}
                  onClick={() => setSelId(r.id)}
                >
                  <div className="between" style={{ marginBottom: 5 }}>
                    <b style={{ margin: 0 }}>{r.title}</b>
                    <span
                      className={`pill ${
                        r.status === "complete" ? "ok" : r.status === "running" ? "info" : "bad"
                      }`}
                    >
                      {r.status}
                    </span>
                  </div>
                  <p>
                    {relTime(r.startedAt)} · {fmtUsd(r.costUsdc)} spent ·{" "}
                    {r.steps.filter((s) => s.status === "done").length}/{r.steps.length} steps
                    {r.deliverableMd ? " · document ready" : ""}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
