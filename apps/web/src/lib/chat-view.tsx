"use client";

import { useEffect, useRef, useState } from "react";
import { Empty, Icon, fmtUsd, relTime } from "./ui";
import { Button } from "@/components/ui/button";

type ExternalAction = {
  id: string;
  platform: string;
  action: string;
  content: string;
  status: "pending" | "approved" | "rejected" | string;
};

type ChatMsg = {
  id: string;
  role: "user" | "assistant" | "system";
  kind: "text" | "approval_request" | "system" | "alert";
  body: string;
  approvalId?: string;
  meta?: Record<string, unknown>;
  createdAt: string;
};

type Approval = {
  id: string;
  agentId: string;
  amountUsdc: string;
  destination: string;
  status: string;
  reasons: string[];
  expiresAt: string;
};

/**
 * ABI Assistant — in-app chat is the primary approval + Q&A surface.
 * Telegram remains an optional notification channel.
 */
export function ChatView({
  gFetch,
  act,
  busy,
  pending,
  agentName,
  onGoto,
  readOnly = false,
}: {
  gFetch: (p: string, i?: RequestInit) => Promise<Response>;
  act: (label: string, fn: () => Promise<string | void>) => Promise<void>;
  busy: boolean;
  pending: Approval[];
  agentName: (id: string) => string;
  onGoto: (view: string) => void;
  readOnly?: boolean;
}) {
  const locked = busy || readOnly;
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const bottom = useRef<HTMLDivElement>(null);
  const msgSig = useRef("");

  async function refresh() {
    if (typeof document !== "undefined" && document.hidden) return;
    const res = await gFetch("/v1/guardian/chat");
    if (!res.ok) return;
    const d = await res.json();
    const next = d.messages ?? [];
    const sig = JSON.stringify(next);
    if (sig === msgSig.current) return;
    msgSig.current = sig;
    setMessages(next);
  }

  useEffect(() => {
    void refresh().finally(() => setLoading(false));
    const t = setInterval(() => void refresh(), 6000);
    const onVis = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function send(text: string) {
    if (!text.trim()) return;
    setDraft("");
    await act("Chat", async () => {
      const res = await gFetch("/v1/guardian/chat", {
        method: "POST",
        body: JSON.stringify({ message: text.trim() }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error?.message ?? "chat failed");
      setMessages(d.messages ?? []);
    });
  }

  const resolve = (id: string, approve: boolean) =>
    act(approve ? "Approve" : "Deny", async () => {
      const res = await gFetch(`/v1/guardian/approvals/${id}/resolve`, {
        method: "POST",
        body: JSON.stringify({ approve }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error?.message ?? JSON.stringify(d.error));
      await refresh();
      return approve ? "Approved — agent can continue." : "Denied — agent was told no.";
    });

  const resolveExternal = (msg: ChatMsg, approve: boolean) => {
    const ext = msg.meta?.externalAction as ExternalAction | undefined;
    if (!ext?.id) return Promise.resolve();
    return act(approve ? "Approve web action" : "Reject web action", async () => {
      const res = await gFetch(`/v1/guardian/chat/external-actions/${ext.id}/resolve`, {
        method: "POST",
        body: JSON.stringify({ approve, messageId: msg.id }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error?.message ?? "resolve failed");
      setMessages(d.messages ?? []);
      return approve
        ? `Queued ${ext.action} on ${ext.platform} (stub — not browsed yet).`
        : `Rejected ${ext.action} on ${ext.platform}.`;
    });
  };

  return (
    <div className="chat-shell card" style={{ display: "flex", flexDirection: "column", minHeight: "70vh" }}>
      <div className="card-head">
        <div>
          <h2>ABI Assistant</h2>
          <div className="sub">
            Org survey agent — agents, spend, budgets, denials, drafts. Web actions need your OK. Never moves money from chat.
          </div>
        </div>
        {pending.length > 0 && (
          <span className="pill warn">
            <i /> {pending.length} waiting
          </span>
        )}
      </div>

      {pending.length > 0 && (
        <div className="chat-approvals">
          {pending.slice(0, 4).map((a) => (
            <div key={a.id} className="chat-approval-card">
              <div>
                <b>
                  {agentName(a.agentId)} · {fmtUsd(a.amountUsdc)}
                </b>
                <div className="faint" style={{ fontSize: 12, marginTop: 3 }}>
                  {a.destination} · expires {relTime(a.expiresAt)}
                </div>
                <div style={{ fontSize: 12, marginTop: 4 }}>{a.reasons[0]}</div>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <Button size="sm" disabled={locked} onClick={() => void resolve(a.id, true)}>
                  Approve
                </Button>
                <Button variant="destructive" size="sm" disabled={locked} onClick={() => void resolve(a.id, false)}>
                  Reject
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="chat-thread">
        {loading ? (
          <div className="thinking">
            <span className="bar" /> loading conversation…
          </div>
        ) : messages.length === 0 ? (
          <Empty icon="spark">
            ABI can survey the org, draft a blurb, or propose a MaltBook post — try a chip below.
          </Empty>
        ) : (
          messages.map((m) => {
            const ext = m.meta?.externalAction as ExternalAction | undefined;
            return (
              <div key={m.id} className={`chat-bubble ${m.role}`}>
                <div className="chat-meta">
                  {m.role === "user" ? "You" : "ABI"} · {relTime(m.createdAt)}
                </div>
                <div className="chat-body">{m.body}</div>
                {Array.isArray(m.meta?.toolsUsed) && (m.meta.toolsUsed as string[]).length > 0 && (
                  <div className="chat-tools" aria-label="Tools used">
                    {(m.meta.toolsUsed as string[]).map((t) => (
                      <span key={t} className="pill mute">
                        <i /> {t.replace(/_/g, " ")}
                      </span>
                    ))}
                  </div>
                )}
                {ext && (
                  <div className="chat-approval-card" style={{ marginTop: 10 }}>
                    <div>
                      <b>
                        {ext.action} · {ext.platform}
                      </b>
                      <div className="faint" style={{ fontSize: 12, marginTop: 3 }}>
                        Status: {ext.status}
                      </div>
                    </div>
                    {ext.status === "pending" && (
                      <div className="row" style={{ gap: 8 }}>
                        <Button size="sm" disabled={locked} onClick={() => void resolveExternal(m, true)}>
                          Approve
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={locked}
                          onClick={() => void resolveExternal(m, false)}
                        >
                          Reject
                        </Button>
                      </div>
                    )}
                  </div>
                )}
                {m.kind === "approval_request" && m.approvalId && (
                  <div className="row" style={{ marginTop: 10, gap: 8 }}>
                    <Button size="sm"
                      disabled={locked || !pending.some((p) => p.id === m.approvalId)}
                      onClick={() => void resolve(m.approvalId!, true)}
                    >
                      Approve
                    </Button>
                    <Button variant="destructive" size="sm"
                      disabled={locked || !pending.some((p) => p.id === m.approvalId)}
                      onClick={() => void resolve(m.approvalId!, false)}
                    >
                      Reject
                    </Button>
                  </div>
                )}
                {typeof m.meta?.goto === "string" && m.meta.goto !== "chat" && (
                  <Button variant="ghost" size="sm" style={{ marginTop: 8 }} onClick={() => onGoto(String(m.meta!.goto))}>
                    Open {String(m.meta.goto)} <Icon name="arrowRight" size={12} />
                  </Button>
                )}
              </div>
            );
          })
        )}
        <div ref={bottom} />
      </div>

      <div className="suggest" style={{ marginTop: 12 }}>
        {[
          "How are the agents?",
          "What is waiting on me?",
          "Show policy bands",
          "Are we in quiet hours?",
          "Any denials?",
        ].map((s) => (
          <button key={s} disabled={locked} onClick={() => void send(s)}>
            {s}
          </button>
        ))}
      </div>

      <div className="ask" style={{ marginTop: 10 }}>
        <input
          placeholder="Ask ABI — agents, policy bands, quiet hours, denials…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void send(draft)}
        />
        <button onClick={() => void send(draft)} disabled={locked || !draft.trim()} aria-label="Send">
          <Icon name="send" />
        </button>
      </div>
    </div>
  );
}
