"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Empty, Icon, Stat, fmtDate, fmtTime, relTime } from "./ui";

type Entry = {
  email: string;
  createdAt: string;
  source: string | null;
  referrer: string | null;
};

/**
 * Owner-only Waitlist view: total, latest signups, CSV export. The API
 * decides who may read it (GET /v1/guardian/waitlist answers 403 otherwise).
 */
export function WaitlistView({
  gFetch,
  setToast,
}: {
  gFetch: (p: string, i?: RequestInit) => Promise<Response>;
  setToast: (m: string, k?: "ok" | "err" | "info") => void;
}) {
  const [data, setData] = useState<{ total: number; entries: Entry[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await gFetch("/v1/guardian/waitlist?limit=1000");
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      setData({ total: body.total, entries: body.entries });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [gFetch]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [load]);

  async function exportCsv() {
    setExporting(true);
    try {
      const res = await gFetch("/v1/guardian/waitlist.csv");
      if (!res.ok) throw new Error(`Export failed (HTTP ${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `abi-waitlist-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setToast("Waitlist exported", "ok");
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e), "err");
    } finally {
      setExporting(false);
    }
  }

  const today = data?.entries.filter(
    (e) => Date.now() - Date.parse(e.createdAt) < 24 * 60 * 60 * 1000,
  ).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="grid g-4">
        <Stat label="On the waitlist" value={data ? String(data.total) : "—"} foot="all time" />
        <Stat
          label="Last 24 hours"
          value={today === undefined ? "—" : String(today)}
          foot="new signups"
        />
      </div>
      <div className="card">
        <div className="card-head">
          <div>
            <h2>Signups</h2>
            <div className="sub">Public form at /waitlist and on the home page. Newest first.</div>
          </div>
          <div className="row">
            <Button variant="ghost" size="sm" onClick={() => void load()}>
              Refresh
            </Button>
            <Button size="sm" disabled={exporting || !data?.total} onClick={() => void exportCsv()}>
              <Icon name="list" size={13} /> Export CSV
            </Button>
          </div>
        </div>
        {error ? (
          <Empty icon="alert">{error}</Empty>
        ) : !data ? (
          <Empty icon="inbox">Loading…</Empty>
        ) : data.entries.length === 0 ? (
          <Empty icon="inbox">No signups yet. Share /waitlist to get the first one.</Empty>
        ) : (
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Joined</th>
                  <th>Source</th>
                  <th>Referrer</th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map((e) => (
                  <tr key={e.email}>
                    <td className="mono">{e.email}</td>
                    <td
                      className="faint mono"
                      title={`${fmtDate(e.createdAt)} ${fmtTime(e.createdAt)}`}
                    >
                      {relTime(e.createdAt)}
                    </td>
                    <td>{e.source ?? "—"}</td>
                    <td className="faint" style={{ overflowWrap: "anywhere" }}>
                      {e.referrer ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.total > data.entries.length && (
          <div className="sub" style={{ marginTop: 10 }}>
            Showing the latest {data.entries.length} of {data.total}. Export CSV for all of them.
          </div>
        )}
      </div>
    </div>
  );
}
