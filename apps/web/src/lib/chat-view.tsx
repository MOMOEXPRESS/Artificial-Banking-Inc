"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Check,
  Copy,
  MessageSquare,
  RefreshCw,
  FileText,
  ImageIcon,
  LoaderCircle,
  Paperclip,
  Settings2,
  ShoppingBag,
  Wallet,
  X,
} from "lucide-react";
import { readChatMessages, type ChatMessage as ChatMsg } from "./chat-conversation";
import { ChatMessageBody } from "./chat-message-body";
import { fmtUsd } from "./ui";
import { viewLabel } from "./console-types";
import { quickReplies } from "./chat-chips";
import { readChatAttachment, type ChatAttachment } from "./chat-attachments";
import { Button } from "@/components/ui/button";

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
type SubmittedMessage = {
  id: string;
  text: string;
  attachments: ChatAttachment[];
  startedAt: string;
};
export type ChatDraft = {
  text: string;
  attachments: ChatAttachment[];
  pending?: SubmittedMessage;
  failed?: SubmittedMessage & { error: string };
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
  workspaceName?: string;
  composer?: { value: ChatDraft; onChange: (update: (current: ChatDraft) => ChatDraft) => void };
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
  workspaceName,
  composer,
}: Props) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [localComposer, setLocalComposer] = useState<ChatDraft>({ text: "", attachments: [] });
  const currentComposer = composer?.value ?? localComposer;
  const updateComposer = composer?.onChange ?? setLocalComposer;
  const { text: draft, attachments: files, pending: submitted, failed } = currentComposer;
  const setDraft = (text: string) => updateComposer((current) => ({ ...current, text }));
  const setFiles = (update: (files: ChatAttachment[]) => ChatAttachment[]) =>
    updateComposer((current) => ({ ...current, attachments: update(current.attachments) }));
  const [loading, setLoading] = useState(true);
  const sending = !!submitted;
  const [configuring, setConfiguring] = useState(false);
  const [showLatest, setShowLatest] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
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
  const preparingFiles = useRef(false);
  const nearBottom = useRef(true);
  const revision = useRef(0);
  const refreshVersion = useRef(0);
  const locked = busy || readOnly || sending || preparing || configuring || loading;

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      const startedAtRevision = revision.current;
      const requestVersion = ++refreshVersion.current;
      const res = await gFetch("/v1/guardian/chat", { signal });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message ?? "Couldn’t load your conversation.");
      if (
        !alive.current ||
        signal?.aborted ||
        inFlight.current ||
        revision.current !== startedAtRevision ||
        requestVersion !== refreshVersion.current
      )
        return;
      const history = readChatMessages(data.messages);
      setMessages(history);
      setLoading(false);
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
    const updated = () => {
      if (!inFlight.current) void refresh(controller.signal).catch(() => {});
    };
    window.addEventListener("abi:chat-updated", updated);
    const timer = setInterval(() => {
      if (!document.hidden && !inFlight.current) void refresh(controller.signal).catch(() => {});
    }, 15_000);
    return () => {
      alive.current = false;
      controller.abort();
      clearInterval(timer);
      window.removeEventListener("abi:chat-updated", updated);
    };
  }, [refresh]);

  useEffect(() => {
    if (nearBottom.current && thread.current)
      thread.current.scrollTop = messages.length || sending ? thread.current.scrollHeight : 0;
  }, [messages, sending]);

  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [draft]);

  useEffect(() => {
    if (compact) return;
    const resize = () => {
      const el = shell.current;
      if (!el) return;
      const viewport = window.visualViewport;
      const bottom = viewport ? viewport.height + viewport.offsetTop : window.innerHeight;
      const mobile = window.innerWidth <= 600;
      const keyboardOpen = viewport && viewport.height < window.innerHeight * 0.75;
      el.style.setProperty(
        "--abi-chat-height",
        `${Math.max(160, bottom - el.getBoundingClientRect().top - (keyboardOpen ? 12 : mobile ? 96 : 32))}px`,
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
    const sent: SubmittedMessage = {
      id: crypto.randomUUID(),
      text: text.trim(),
      attachments: files,
      startedAt: new Date().toISOString(),
    };
    inFlight.current = true;
    revision.current++;
    updateComposer((current) => ({
      ...current,
      text: "",
      attachments: [],
      pending: sent,
      failed: undefined,
    }));
    setError("");
    nearBottom.current = true;
    setShowLatest(false);
    let failure: string | undefined;
    try {
      const res = await gFetch("/v1/guardian/chat", {
        method: "POST",
        body: JSON.stringify({ message: sent.text, attachments: sent.attachments }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message ?? "Your reply couldn’t be confirmed.");
      if (alive.current) setMessages(readChatMessages(data.messages));
    } catch (e) {
      failure = e instanceof Error ? e.message : "Your reply couldn’t be confirmed.";
    } finally {
      inFlight.current = false;
      updateComposer((current) =>
        current.pending?.id === sent.id
          ? {
              ...current,
              pending: undefined,
              failed: failure ? { ...sent, error: failure } : undefined,
            }
          : current,
      );
      if (alive.current) input.current?.focus();
      window.dispatchEvent(new Event("abi:chat-updated"));
    }
  }

  function suggest(text: string) {
    setDraft(text);
    input.current?.focus();
  }

  async function copyMessage(message: ChatMsg) {
    try {
      await navigator.clipboard.writeText(message.body);
      setCopied(message.id);
    } catch {
      setError("Copy is unavailable in this browser. Select the reply text to copy it.");
    }
  }

  async function addFiles(list: FileList | null) {
    if (!list?.length || locked || preparingFiles.current) return;
    if (!ai?.modelEnabled) {
      setError("Enable a model in Assistant settings before adding attachments.");
      return;
    }
    if (files.length + list.length > 3) {
      setError("Attach up to three files per message.");
      return;
    }
    preparingFiles.current = true;
    setPreparing(true);
    setError("");
    try {
      const next = await Promise.all(Array.from(list).map(readChatAttachment));
      if (alive.current) setFiles((prev) => [...prev, ...next]);
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : "Couldn’t read that file.");
    } finally {
      preparingFiles.current = false;
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
    setConfiguring(true);
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
      if (alive.current) setConfiguring(false);
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
          <h2>{compact ? "Your workspace assistant" : "ABI Assistant"}</h2>
          <span>
            {workspaceName ? `${workspaceName} workspace · ` : ""}
            {ai?.modelEnabled ? "Ready to help" : "Account guidance"}
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
      <div className="abi-chat-conversation">
        <div
          className="abi-chat-thread"
          ref={thread}
          onScroll={() => {
            const el = thread.current;
            if (el) {
              nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
              setShowLatest(!nearBottom.current);
            }
          }}
          tabIndex={0}
          aria-label="Conversation history"
          role="log"
          aria-live="polite"
          aria-relevant="additions"
          aria-busy={loading}
        >
          {loading ? (
            <p className="abi-chat-status">
              <LoaderCircle size={16} className="abi-chat-spinner" /> Loading conversation…
            </p>
          ) : messages.length === 0 && !submitted ? (
            <div className="abi-chat-welcome">
              <span className="abi-chat-welcome-mark">
                <MessageSquare size={27} strokeWidth={1.5} />
              </span>
              <span className="abi-chat-eyebrow">A little clarity, whenever you need it</span>
              <h3>What can we help you understand?</h3>
              <p>Make sense of your balances, review spending, or find what your agents need.</p>
              <div className="abi-chat-starters">
                <button
                  disabled={locked}
                  onClick={() => suggest("Help me find a product on the marketplace")}
                >
                  <ShoppingBag size={17} /> Find something on the marketplace{" "}
                  <ArrowUpRight size={15} />
                </button>
                <button
                  disabled={locked}
                  onClick={() => suggest("Explain my available balance and spending budget")}
                >
                  <Wallet size={17} /> Understand my balance <ArrowUpRight size={15} />
                </button>
                <button
                  disabled={locked}
                  onClick={() =>
                    suggest("Summarize recent payments and anything that needs my attention")
                  }
                >
                  <RefreshCw size={17} /> Review recent activity <ArrowUpRight size={15} />
                </button>
              </div>
            </div>
          ) : (
            messages.map((m) => (
              <article key={m.id} className={`abi-chat-message abi-chat-${m.role}`}>
                <span className="abi-chat-speaker">
                  {m.role === "user" ? "You" : m.role === "system" ? "Activity" : "ABI Assistant"}
                </span>
                <div className="abi-chat-message-body">
                  {m.role === "assistant" ? <ChatMessageBody text={m.body} /> : m.body}
                </div>
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
                <div className="abi-chat-message-tools">
                  <time dateTime={m.createdAt}>
                    {Number.isNaN(Date.parse(m.createdAt))
                      ? ""
                      : new Date(m.createdAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                  </time>
                  {m.role === "assistant" && (
                    <button
                      type="button"
                      className="abi-chat-icon"
                      aria-label={copied === m.id ? "Reply copied" : "Copy reply"}
                      onClick={() => void copyMessage(m)}
                    >
                      {copied === m.id ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                  )}
                </div>
                {typeof m.meta?.goto === "string" && m.meta.goto !== "chat" && (
                  <button className="abi-chat-link" onClick={() => onGoto(String(m.meta!.goto))}>
                    Open {viewLabel(String(m.meta.goto))}
                    <ArrowUpRight size={14} />
                  </button>
                )}
              </article>
            ))
          )}
          {submitted &&
            !messages.some(
              (m) =>
                m.role === "user" &&
                m.body === submitted.text &&
                Date.parse(m.createdAt) >= Date.parse(submitted.startedAt) - 1000,
            ) && (
              <article className="abi-chat-message abi-chat-user">
                <span className="abi-chat-speaker">You</span>
                <div className="abi-chat-message-body">{submitted.text}</div>
                {submitted.attachments.map((f, i) => (
                  <small key={i}>
                    <FileText size={12} /> {f.name}
                  </small>
                ))}
                <small>Awaiting reply</small>
              </article>
            )}
          {sending && (
            <p className="abi-chat-status" role="status">
              <LoaderCircle className="abi-chat-spinner" size={16} /> ABI is preparing a reply…
            </p>
          )}
        </div>
        {showLatest && (messages.length > 0 || submitted) && (
          <button
            type="button"
            className="abi-chat-jump"
            onClick={() => {
              if (thread.current) thread.current.scrollTop = thread.current.scrollHeight;
              nearBottom.current = true;
              setShowLatest(false);
            }}
          >
            <ArrowDown size={14} /> Latest messages
          </button>
        )}
      </div>
      {pending.length > 0 && (
        <details className="abi-chat-approvals" aria-label="Pending approvals">
          <summary>
            {pending.length} {pending.length === 1 ? "approval needs" : "approvals need"} your
            review
          </summary>
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
        </details>
      )}
      <footer className="abi-chat-footer">
        <span className="sr-only" role="status">
          {copied ? "Reply copied to clipboard" : ""}
        </span>
        {messages.length > 0 && (
          <div className="abi-chat-suggestions" aria-label="Suggested questions">
            {quickReplies(messages)
              .slice(0, 3)
              .map((s) => (
                <button disabled={locked} key={s} onClick={() => suggest(s)}>
                  {s}
                </button>
              ))}
          </div>
        )}
        {failed && (
          <div className="abi-chat-error" role="alert">
            <strong>Reply not confirmed</strong>
            <p>
              {failed.error} Your message may have reached ABI. Refresh the conversation before
              sending it again.
            </p>
            <div>
              <button
                type="button"
                onClick={() => void refresh().catch((e) => setError(e.message))}
              >
                Refresh conversation
              </button>
              <button
                type="button"
                disabled={!!draft.trim() || files.length > 0}
                onClick={() => {
                  updateComposer((current) => ({
                    ...current,
                    text: failed.text,
                    attachments: failed.attachments,
                    failed: undefined,
                  }));
                  input.current?.focus();
                }}
              >
                Restore draft
              </button>
              <button
                type="button"
                onClick={() => updateComposer((current) => ({ ...current, failed: undefined }))}
              >
                Dismiss
              </button>
            </div>
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
            placeholder={readOnly ? "You have read-only access" : "Ask about your workspace…"}
            rows={1}
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
              {preparing
                ? "Preparing files…"
                : sending
                  ? "You can draft your next message"
                  : "Shift + Enter for a new line"}
            </span>
            {draft.length > 3500 && (
              <small className="abi-chat-character-count">{draft.length}/4000</small>
            )}
            <button
              type="submit"
              className="abi-chat-send"
              disabled={locked || !draft.trim()}
              aria-label="Send message"
            >
              {sending ? (
                <LoaderCircle size={18} className="abi-chat-spinner" />
              ) : (
                <ArrowUp size={18} />
              )}
            </button>
          </div>
        </form>
        <p className="abi-chat-footnote">
          {readOnly
            ? "Your role has read-only access."
            : files.length
              ? "Attachments go to your model. Text is saved; images are used for this message only."
              : "Conversations stay with this workspace. Purchases follow your spending controls."}
        </p>
      </footer>
    </section>
  );
}
