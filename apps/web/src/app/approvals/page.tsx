"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { fmtUsd, relTime } from "../../lib/ui";
import { Button } from "@/components/ui/button";

const API = process.env.NEXT_PUBLIC_API_URL ?? "/abi-api";

type Session = { guardianKey: string; orgId?: string };
type Approval = {
  id: string;
  agentId: string;
  amountUsdc: string;
  destination: string;
  tool: string;
  memo?: string;
  reasons: string[];
  expiresAt: string;
  status: string;
};

/** Mobile-first approvals inbox — PWA / approve-on-the-go v0. */
export default function MobileApprovalsPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [pending, setPending] = useState<Approval[]>([]);
  const [agents, setAgents] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("pv_session");
      if (raw) setSession(JSON.parse(raw));
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, []);

  const gFetch = useCallback(
    async (path: string, init?: RequestInit) =>
      fetch(`${API}${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.guardianKey ?? ""}`,
          ...(init?.headers ?? {}),
        },
      }),
    [session],
  );

  const refresh = useCallback(async () => {
    if (!session) return;
    const [aRes, oRes] = await Promise.all([gFetch("/v1/guardian/approvals"), gFetch("/v1/guardian/org")]);
    const approvals = (await aRes.json()) as Approval[];
    const org = await oRes.json();
    const map: Record<string, string> = {};
    for (const ag of org.agents ?? []) map[ag.id] = ag.name;
    setAgents(map);
    setPending(approvals.filter((x) => x.status === "pending"));
  }, [gFetch, session]);

  useEffect(() => {
    if (!session) return;
    void refresh();
    const t = setInterval(() => void refresh(), 8000);
    return () => clearInterval(t);
  }, [session, refresh]);

  async function resolve(id: string, approve: boolean) {
    setBusy(id);
    try {
      const res = await gFetch(`/v1/guardian/approvals/${id}/resolve`, {
        method: "POST",
        body: JSON.stringify({ approve, resolvedBy: "guardian-mobile" }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(d.error ?? d));
      setMsg(approve ? "Approved — payment executed." : "Denied — agent replanning.");
      await refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      setTimeout(() => setMsg(null), 5000);
    }
  }

  if (!hydrated) return null;

  if (!session) {
    return (
      <div className="mobile-approvals">
        <header className="mobile-approvals-head">
          <h1>Approvals</h1>
          <p className="muted">Sign in from the console first, then bookmark this page.</p>
        </header>
        <Link className="btn-primary mobile-approvals-cta" href="/console">
          Open console to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="mobile-approvals">
      <header className="mobile-approvals-head">
        <div className="between">
          <h1>Approvals</h1>
          <Link className="text-xs text-[var(--color-fg-muted)]" href="/console">
            Console
          </Link>
        </div>
        <p className="muted">{pending.length} waiting · auto-refreshes every 8s</p>
      </header>

      {msg && <div className="mobile-approvals-toast">{msg}</div>}

      {pending.length === 0 ? (
        <div className="mobile-approvals-empty">
          <p>Inbox zero — nothing needs you right now.</p>
        </div>
      ) : (
        <ul className="mobile-approvals-list">
          {pending.map((a) => (
            <li key={a.id} className="mobile-approval-card">
              <div className="mobile-approval-amt">{fmtUsd(a.amountUsdc)}</div>
              <div className="mobile-approval-meta">
                <b>{agents[a.agentId] ?? a.agentId.slice(0, 8)}</b>
                <span className="mono">{a.destination}</span>
              </div>
              <div className="faint">{a.reasons.join(" · ")}</div>
              <div className="faint">expires {relTime(a.expiresAt)}</div>
              <div className="mobile-approval-actions">
                <Button size="sm" disabled={busy === a.id} onClick={() => void resolve(a.id, true)}>
                  Approve
                </Button>
                <Button variant="destructive" size="sm" disabled={busy === a.id} onClick={() => void resolve(a.id, false)}>
                  Deny
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
