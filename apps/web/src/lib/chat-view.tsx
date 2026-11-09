"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  ArrowUpRight,
  Check,
  FileText,
  ImageIcon,
  LoaderCircle,
  Paperclip,
  Settings2,
  ShoppingBag,
  Wallet,
  X,
} from "lucide-react";
import { fmtUsd } from "./ui";
import { viewLabel } from "./console-types";
import { quickReplies } from "./chat-chips";
import { readChatAttachment, type ChatAttachment } from "./chat-attachments";
import { Button } from "@/components/ui/button";

type ChatMsg = {
  id: string;
  role: "user" | "assistant" | "system";
  kind: string;
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
type Ai = {
  modelEnabled: boolean;
  mode: string;
  model: string;
  egressHost: string | null;
  note?: string;
};
type Props = {
  gFetch: (p: string, i?: RequestInit) => Promise<Response>;
  act: (label: string, fn: () => Promise<string | void>) => Promise<void>;
  busy: boolean;
  pending: Approval[];
  agentName: (id: string) => string;
  onGoto: (view: string) => void;
  readOnly?: boolean;
  compact?: boolean;
  canConfigure?: boolean;
};

export function ChatView({
  gFetch,
  act,
  busy,
  pending,
  agentName,
  onGoto,
  readOnly = false,
  compact = false,
  canConfigure = false,
}: Props) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<ChatAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState("");
  const [ai, setAi] = useState<Ai | null>(null);
  const [settings, setSettings] = useState(false);
  const [credential, setCredential] = useState("");
  const [model, setModel] = useState("gpt-4o-mini");
  const [consent, setConsent] = useState(false);
  const [disclosure, setDisclosure] = useState<string[]>([]);
  const shell = useRef<HTMLElement>(null);
  const thread = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const upload = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  const inFlight = useRef(false);
  const nearBottom = useRef(true);
  const locked = busy || readOnly || sending || preparing;

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      const res = await gFetch("/v1/guardian/chat", { signal });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message ?? "Couldn’t load your conversation.");
      if (!alive.current || signal?.aborted) return;
      setMessages(data.messages ?? []);
      if (data.assistant) setAi(data.assistant);
    },
    [gFetch],
  );

  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    void refresh(controller.signal)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    const timer = setInterval(() => {
      if (!document.hidden && !inFlight.current) void refresh(controller.signal).catch(() => {});
    }, 15_000);
    return () => {
      alive.current = false;
      controller.abort();
      clearInterval(timer);
    };
  }, [refresh]);

  useEffect(() => {
    if (nearBottom.current && thread.current)
      thread.current.scrollTop = thread.current.scrollHeight;
  }, [messages, sending]);

  useEffect(() => {
    if (compact) return;
    const resize = () => {
      const el = shell.current;
      if (!el) return;
      const viewport = window.visualViewport;
      const bottom = viewport ? viewport.height + viewport.offsetTop : window.innerHeight;
      el.style.setProperty(
        "--abi-chat-height",
        `${Math.max(280, bottom - el.getBoundingClientRect().top - 115)}px`,
      );
    };
    const frame = requestAnimationFrame(resize);
    window.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("resize", resize);
    };
  }, [compact]);

  async function send(text: string) {
    if (locked || inFlight.current || !text.trim()) return;
    inFlight.current = true;
    setSending(true);
    setError("");
    nearBottom.current = true;
    try {
      const res = await gFetch("/v1/guardian/chat", {
        method: "POST",
        body: JSON.stringify({ message: text.trim(), attachments: files }),
      });
      const data = await res.json();
      if (!res.ok)
        throw new Error(data.error?.message ?? "Your message couldn’t be sent. Please try again.");
      if (!alive.current) return;
      setMessages(data.messages ?? []);
      setDraft("");
      setFiles([]);
      input.current?.focus();
    } catch (e) {
      if (alive.current)
        setError(e instanceof Error ? e.message : "Couldn’t send. Please try again.");
    } finally {
      inFlight.current = false;
      if (alive.current) setSending(false);
    }
  }

  async function addFiles(list: FileList | null) {
    if (!list?.length || locked) return;
    if (!ai?.modelEnabled) {
      setError("Enable a model in Assistant settings before adding attachments.");
      return;
    }
    if (files.length + list.length > 3) {
      setError("Attach up to three files per message.");
      return;
    }
    setPreparing(true);
    setError("");
    try {
      const next = await Promise.all(Array.from(list).map(readChatAttachment));
      if (alive.current) setFiles((prev) => [...prev, ...next]);
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : "Couldn’t read that file.");
    } finally {
      if (alive.current) setPreparing(false);
      if (upload.current) upload.current.value = "";
    }
  }

  async function openSettings() {
    setSettings((v) => !v);
    try {
      const res = await gFetch("/v1/guardian/settings/ai");
      if (!res.ok) throw new Error("Couldn’t load Assistant settings.");
      const data = await res.json();
      if (!alive.current) return;
      setDisclosure(data.discloses ?? []);
      setModel(data.ai?.model ?? "gpt-4o-mini");
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    }
  }

  async function configure(mode: "off" | "platform" | "byo") {
    if (locked || (mode !== "off" && !consent)) return;
    setSending(true);
    setError("");
    try {
      const res = await gFetch("/v1/guardian/settings/ai", {
        method: "PUT",
        body: JSON.stringify({
          mode,
          ...(mode === "byo"
            ? { apiKey: credential, model, baseUrl: "https://api.openai.com/v1" }
            : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok)
        throw new Error(data.error?.message ?? "Only a workspace owner can change model settings.");
      if (!alive.current) return;
      setCredential("");
      setConsent(false);
      await refresh();
      setSettings(false);
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setSending(false);
    }
  }

  const resolve = (id: string, approve: boolean) =>
    act(approve ? "Approve" : "Deny", async () => {
      const res = await gFetch(`/v1/guardian/approvals/${id}/resolve`, {
        method: "POST",
        body: JSON.stringify({ approve }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message ?? "Couldn’t resolve approval.");
      await refresh();
      return data.pendingQuorum
        ? (data.message ?? "Vote recorded.")
        : approve
          ? "Approved — agent can continue."
          : "Denied.";
    });

  return (
    <section
      ref={shell}
      className={`abi-chat ${compact ? "abi-chat-compact" : "abi-chat-full"}`}
      aria-label="ABI Assistant conversation"
    >
      <header className="abi-chat-header">
        <div>
          <h2>ABI Assistant</h2>
          <span>
            {ai?.modelEnabled
              ? `Connected to ${ai.egressHost ?? "your model"}`
              : "Marketplace & spending · limited mode"}
          </span>
        </div>
        <button
          type="button"
          className="abi-chat-icon"
          aria-label="Assistant settings"
          aria-expanded={settings}
          onClick={() => void openSettings()}
        >
          <Settings2 size={18} />
        </button>
      </header>
      {settings && (
        <div className="abi-chat-settings">
          <h3>Model & privacy</h3>
          <p>
            The local assistant can read marketplace and account facts. Enable a model for
            conversational reasoning and attachments. Only an owner can change this.
          </p>
          <p>
            Enabling a model sends your conversation, attachments, saved notes and relevant
            financial context to the configured provider.
          </p>
          {disclosure.length > 0 && (
            <details>
              <summary>Data shared with the provider</summary>
              <ul>
                {disclosure.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            </details>
          )}
          {ai?.note && <p>{ai.note}</p>}
          <label>
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />{" "}
            I agree to send this workspace’s context to the model provider.
          </label>
          <Button
            disabled={locked || !canConfigure || !consent}
            onClick={() => void configure("platform")}
          >
            Use ABI’s configured model
          </Button>
          <details>
            <summary>Use your OpenAI account</summary>
            <p>The key is encrypted on the server and never shown again.</p>
            <label>
              OpenAI API key
              <input
                type="password"
                autoComplete="off"
                value={credential}
                onChange={(e) => setCredential(e.target.value)}
              />
            </label>
            <label>
              Model
              <input value={model} onChange={(e) => setModel(e.target.value)} maxLength={80} />
            </label>
            <Button
              disabled={locked || !canConfigure || !consent || !credential.trim()}
              onClick={() => void configure("byo")}
            >
              Connect model
            </Button>
          </details>
          {ai?.mode !== "off" && (
            <Button
              variant="ghost"
              disabled={locked || !canConfigure}
              onClick={() => void configure("off")}
            >
              Keep data local
            </Button>
          )}
        </div>
      )}
      <div
        className="abi-chat-thread"
        ref={thread}
        onScroll={() => {
          const el = thread.current;
          if (el) nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
        }}
        tabIndex={0}
        aria-label="Conversation history"
        aria-busy={loading}
      >
        {loading ? (
          <p className="abi-chat-status">
            <LoaderCircle size={16} className="abi-chat-spinner" /> Loading conversation…
          </p>
        ) : messages.length === 0 ? (
          <div className="abi-chat-welcome">
            <ShoppingBag size={30} strokeWidth={1.4} />
            <h3>What are you looking for?</h3>
            <p>Find something on the marketplace, compare your options or check your spending.</p>
            <div className="abi-chat-starters">
              <button disabled={locked} onClick={() => void send("Search marketplace products")}>
                <ShoppingBag size={17} /> Browse the marketplace <ArrowUpRight size={15} />
              </button>
              <button
                disabled={locked}
                onClick={() => void send("Show my budget and available balance")}
              >
                <Wallet size={17} /> Check my budget <ArrowUpRight size={15} />
              </button>
            </div>
          </div>
        ) : (
          messages.map((m) => (
            <article key={m.id} className={`abi-chat-message abi-chat-${m.role}`}>
              <span className="abi-chat-speaker">{m.role === "user" ? "You" : "ABI"}</span>
              <div className="abi-chat-message-body">{m.body}</div>
              {Array.isArray(m.meta?.attachments) && (
                <div className="abi-chat-file-list">
                  {(m.meta.attachments as { name: string; kind: string }[]).map((f, i) => (
                    <span key={i}>
                      <FileText size={13} />
                      {f.name}
                    </span>
                  ))}
                </div>
              )}
              {m.role === "assistant" && m.meta?.via === "keywords" && (
                <small>Local assistant</small>
              )}
              {typeof m.meta?.goto === "string" && m.meta.goto !== "chat" && (
                <button className="abi-chat-link" onClick={() => onGoto(String(m.meta!.goto))}>
                  Open {viewLabel(String(m.meta.goto))}
                  <ArrowUpRight size={14} />
                </button>
              )}
            </article>
          ))
        )}
        {sending && (
          <p className="abi-chat-status" role="status">
            <LoaderCircle className="abi-chat-spinner" size={16} /> ABI is working…
          </p>
        )}
      </div>
      {pending.length > 0 && (
        <div className="abi-chat-approvals" aria-label="Pending approvals">
          {pending.slice(0, 2).map((a) => (
            <div key={a.id}>
              <p>
                <b>
                  {agentName(a.agentId)} · {fmtUsd(a.amountUsdc)}
                </b>
                <br />
                {a.destination}
                <br />
                {a.reasons[0]}
              </p>
              <div>
                <Button size="sm" disabled={locked} onClick={() => void resolve(a.id, true)}>
                  <Check size={14} />
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={locked}
                  onClick={() => void resolve(a.id, false)}
                >
                  Deny
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      <footer className="abi-chat-footer">
        {messages.length > 0 && (
          <div className="abi-chat-suggestions" aria-label="Suggested questions">
            {quickReplies(messages)
              .slice(0, 3)
              .map((s) => (
                <button disabled={locked} key={s} onClick={() => void send(s)}>
                  {s}
                </button>
              ))}
          </div>
        )}
        {error && (
          <p className="abi-chat-error" role="alert">
            {error}
            <button
              type="button"
              onClick={() => {
                setError("");
                void refresh().catch((e) => setError(e.message));
              }}
            >
              Retry connection
            </button>
          </p>
        )}
        <form
          className="abi-chat-composer"
          onSubmit={(e) => {
            e.preventDefault();
            void send(draft);
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void addFiles(e.dataTransfer.files);
          }}
        >
          {files.length > 0 && (
            <div className="abi-chat-file-list">
              {files.map((f, i) => (
                <span key={i}>
                  {f.kind === "image" ? <ImageIcon size={14} /> : <FileText size={14} />}
                  {f.name}
                  <button
                    type="button"
                    aria-label={`Remove ${f.name}`}
                    disabled={locked}
                    onClick={() => setFiles((prev) => prev.filter((_, n) => n !== i))}
                  >
                    <X size={14} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <textarea
            ref={input}
            aria-label="Message ABI"
            placeholder="Ask ABI to find, compare or explain…"
            rows={2}
            maxLength={4000}
            value={draft}
            disabled={readOnly}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send(draft);
              }
            }}
          />
          <div className="abi-chat-composer-actions">
            <input
              ref={upload}
              hidden
              type="file"
              multiple
              accept="image/png,image/jpeg,image/webp,.txt,.md,.csv,.json"
              onChange={(e) => void addFiles(e.target.files)}
            />
            <button
              className="abi-chat-icon"
              type="button"
              disabled={locked}
              aria-label="Attach images or text files"
              onClick={() => upload.current?.click()}
            >
              <Paperclip size={19} />
            </button>
            <span>
              {preparing ? "Preparing files…" : "Enter to send · Shift + Enter for a new line"}
            </span>
            <button
              type="submit"
              className="abi-chat-send"
              disabled={locked || !draft.trim()}
              aria-label="Send message"
            >
              <ArrowUp size={18} />
            </button>
          </div>
        </form>
        <p className="abi-chat-footnote">
          {readOnly
            ? "Your role has read-only access."
            : files.length
              ? "Attachments go to your model. Text is saved; images are used for this message only."
              : "Saved to this workspace. Checkout and spending rules apply to purchases."}
        </p>
      </footer>
    </section>
  );
}
