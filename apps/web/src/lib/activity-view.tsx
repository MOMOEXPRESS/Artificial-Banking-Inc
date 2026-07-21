"use client";

import { useMemo, useState } from "react";
import { Empty, Icon, Stat, fmtTime, fmtUsd, relTime } from "./ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Decision } from "./console-types";
import { Button } from "@/components/ui/button";

export function Activity({
  decisions,
  agentName,
  setToast,
  query,
  gFetch,
}: {
  decisions: Decision[];
  agentName: (id: string) => string;
  setToast: (m: string, k?: "ok" | "err" | "info") => void;
  query: string;
  gFetch: (path: string, init?: RequestInit) => Promise<Response>;
}) {
  const [filter, setFilter] = useState<"all" | "allow" | "deny" | "review">("all");
  const [agentF, setAgentF] = useState("all");
  const [toolF, setToolF] = useState("all");
  const [destF, setDestF] = useState("all");

  // Facet options come from the data itself, so they always match what exists.
  const agentOpts = useMemo(
    () => [...new Set(decisions.map((d) => d.agentId))].map((id) => ({ id, name: agentName(id) })),
    [decisions, agentName],
  );
  const toolOpts = useMemo(() => [...new Set(decisions.map((d) => d.tool))], [decisions]);
  const destOpts = useMemo(
    () => [...new Set(decisions.map((d) => d.destination.replace(/^https?:\/\//, "").split("/")[0]))],
    [decisions],
  );

  const rows = useMemo(
    () =>
      decisions.filter((d) => {
        const dest = d.destination.replace(/^https?:\/\//, "").split("/")[0];
        return (
          (filter === "all" || d.outcome === filter) &&
          (agentF === "all" || d.agentId === agentF) &&
          (toolF === "all" || d.tool === toolF) &&
          (destF === "all" || dest === destF) &&
          (!query ||
            d.destination.toLowerCase().includes(query.toLowerCase()) ||
            agentName(d.agentId).toLowerCase().includes(query.toLowerCase()) ||
            d.ruleIds.join(" ").toLowerCase().includes(query.toLowerCase()))
        );
      }),
    [decisions, filter, agentF, toolF, destF, query, agentName],
  );

  const shownTotal = rows
    .filter((d) => d.outcome === "allow")
    .reduce((a, d) => a + Number(d.amountUsdc), 0);
  const filtersActive = filter !== "all" || agentF !== "all" || toolF !== "all" || destF !== "all";

  const counts = {
    allow: decisions.filter((d) => d.outcome === "allow").length,
    deny: decisions.filter((d) => d.outcome === "deny").length,
    review: decisions.filter((d) => d.outcome === "review").length,
  };

  async function exportCsv() {
    try {
      const res = await gFetch("/v1/guardian/audit/export?limit=2000", {
        headers: { Accept: "text/csv" },
      });
      if (!res.ok) throw new Error("export failed");
      const text = await res.text();
      const blob = new Blob([text], { type: "text/csv" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `abi-audit-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      setToast("Exported server audit CSV (decisions + freezes).", "ok");
    } catch {
      // Fallback to filtered client CSV if the server export is unavailable.
      const head = "time,agent,outcome,tool,amount_usdc,destination,rules,reasons";
      const body = rows.map((d) =>
        [
          d.at,
          agentName(d.agentId),
          d.outcome,
          d.tool,
          d.amountUsdc,
          d.destination,
          d.ruleIds.join("|"),
          `"${d.reasons.join("; ").replace(/"/g, '""')}"`,
        ].join(","),
      );
      const blob = new Blob([[head, ...body].join("\n")], { type: "text/csv" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `policyvault-activity-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      setToast(`Exported ${rows.length} filtered decisions (client fallback).`, "ok");
    }
  }

  return (
    <>
      <div className="grid g-4">
        <Stat label="Total decisions" value={String(decisions.length)} foot="every intent, ever" />
        <Stat label="Allowed" value={String(counts.allow)} foot="settled under policy" />
        <Stat label="Denied" value={String(counts.deny)} foot="refused by a rule" />
        <Stat label="Sent for review" value={String(counts.review)} foot="escalated to you" />
      </div>

      <div className="card fill" style={{ display: "flex", flexDirection: "column" }}>
        <div className="card-head">
          <div>
            <h2>Decision trail</h2>
            <div className="sub">
              {rows.length} of {decisions.length} shown · {fmtUsd(shownTotal)} settled in this view
              {query ? ` · matching “${query}”` : ""}
            </div>
          </div>
          <div className="row">
            <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
              <TabsList>
                {(["all", "allow", "review", "deny"] as const).map((k) => (
                  <TabsTrigger key={k} value={k}>
                    {k}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <Button variant="ghost" size="sm" onClick={() => void exportCsv()} disabled={!decisions.length}>
              <Icon name="download" size={13} /> CSV
            </Button>
          </div>
        </div>

        <div className="row" style={{ marginBottom: 14, gap: 8 }}>
          <Select value={agentF} onValueChange={setAgentF}>
            <SelectTrigger style={{ width: 170 }}>
              <SelectValue placeholder="All agents" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All agents</SelectItem>
              {agentOpts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={toolF} onValueChange={setToolF}>
            <SelectTrigger style={{ width: 170 }}>
              <SelectValue placeholder="All tools" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All tools</SelectItem>
              {toolOpts.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={destF} onValueChange={setDestF}>
            <SelectTrigger style={{ width: 210 }}>
              <SelectValue placeholder="All destinations" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All destinations</SelectItem>
              {destOpts.map((d) => (
                <SelectItem key={d} value={d}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {filtersActive && (
            <Button variant="bare" size="sm"
              onClick={() => {
                setFilter("all");
                setAgentF("all");
                setToolF("all");
                setDestF("all");
              }}
            >
              <Icon name="x" size={12} /> Clear filters
            </Button>
          )}
        </div>
        {rows.length === 0 ? (
          <Empty icon="list">Nothing matches. Run a mission in the Playground to generate activity.</Empty>
        ) : (
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Agent</th>
                  <th>Outcome</th>
                  <th>Tool</th>
                  <th className="num">Amount</th>
                  <th>Destination</th>
                  <th>Rule fired</th>
                  <th>Why</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.intentId + d.at}>
                    <td className="mono faint">{fmtTime(d.at)}</td>
                    <td>{agentName(d.agentId)}</td>
                    <td>
                      <span
                        className={`pill ${
                          d.outcome === "allow" ? "ok" : d.outcome === "deny" ? "bad" : "warn"
                        }`}
                      >
                        <i /> {d.outcome}
                      </span>
                    </td>
                    <td className="mono">{d.tool}</td>
                    <td className="num mono">{fmtUsd(d.amountUsdc)}</td>
                    <td className="mono">{d.destination.replace(/^https?:\/\//, "")}</td>
                    <td className="mono faint">{d.ruleIds.join(", ")}</td>
                    <td className="muted wrap">{d.reasons[0]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

