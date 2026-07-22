"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ABLockup } from "./brand";
import { Icon } from "./ui";
import type { AgentKey, Session } from "./console-types";
import { Button } from "@/components/ui/button";

const API = process.env.NEXT_PUBLIC_API_URL ?? "/abi-api";

/** Total intro timeline (ms) before the login card is interactive. */
const INTRO_MS = 4200;

async function readApiError(res: Response): Promise<string> {
  try {
    const d = (await res.json()) as { error?: { code?: string; message?: string } };
    if (d.error?.code === "API_NOT_CONFIGURED" || d.error?.code === "API_UNREACHABLE") {
      return d.error.message ?? d.error.code;
    }
    if (d.error?.message) return d.error.message;
  } catch {
    /* ignore non-JSON */
  }
  return `HTTP ${res.status}`;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

function keysMarkdown(session: Session): string {
  const when = new Date().toISOString();
  const agents = session.agentKeys
    .map((a) => `### ${a.name}\n\n\`${a.key}\`\n\nAgent id: \`${a.agentId}\``)
    .join("\n\n");
  return `# Artificial Banking — org keys

Generated: ${when}
${session.orgId ? `Org id: \`${session.orgId}\`` : ""}

Treat these like root passwords. Anyone with the guardian key can approve spend and change policy.
We cannot show them again from the server — only a hash is stored.

## Guardian key

\`${session.guardianKey}\`

## Agent API keys

${agents || "_No agent keys in this session._"}

---

Not a bank. Not FDIC insured. Demo float is sample money unless you fund the vault yourself.
`;
}

function downloadKeysFile(session: Session) {
  const body = keysMarkdown(session);
  const blob = new Blob([body], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `artificial-banking-keys-${stamp}.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

type Phase = "intro" | "ready" | "keys";

export function Login({
  onLogin,
  setToast,
}: {
  onLogin: (s: Session) => void;
  setToast: (m: string, k?: "ok" | "err" | "info") => void;
}) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<Phase>("intro");
  const [pending, setPending] = useState<Session | null>(null);
  const [savedAck, setSavedAck] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setPhase("ready");
      return;
    }
    const t = window.setTimeout(() => setPhase("ready"), INTRO_MS);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(null), 1600);
    return () => window.clearTimeout(t);
  }, [copied]);

  async function connect() {
    setBusy(true);
    try {
      const res = await fetch(`${API}/v1/guardian/org`, {
        headers: { Authorization: `Bearer ${key.trim()}` },
      });
      if (!res.ok) throw new Error(await readApiError(res));
      const data = await res.json();
      onLogin({ guardianKey: key.trim(), orgId: data.org.id, agentKeys: [] });
    } catch (e) {
      setToast(`Connect failed: ${String(e)}`, "err");
    } finally {
      setBusy(false);
    }
  }

  async function bootstrap() {
    setBusy(true);
    try {
      const res = await fetch(`${API}/v1/demo/bootstrap`, { method: "POST" });
      const d = await res.json();
      if (!res.ok) {
        throw new Error(d.error?.message ?? d.error?.code ?? `HTTP ${res.status}`);
      }
      const session: Session = {
        guardianKey: d.guardianKey,
        orgId: d.orgId,
        agentKeys: [
          { agentId: d.researcherAgentId, name: "Researcher", key: d.agentApiKey },
          { agentId: d.writerAgentId, name: "Writer", key: d.writerApiKey },
        ],
      };
      setPending(session);
      setSavedAck(false);
      setCopied(null);
      setPhase("keys");
      setToast("Org created — save your keys before entering the console.", "ok");
    } catch (e) {
      setToast(`Bootstrap failed: ${String(e)}`, "err");
    } finally {
      setBusy(false);
    }
  }

  async function onCopy(label: string, text: string) {
    const ok = await copyText(text);
    if (ok) {
      setCopied(label);
      setToast(`Copied ${label}`, "ok");
    } else {
      setToast("Could not copy — select the key and copy manually.", "err");
    }
  }

  function enterConsole() {
    if (!pending || !savedAck) return;
    onLogin(pending);
  }

  const showVault = phase === "intro";
  const showLogin = phase === "ready";
  const showKeys = phase === "keys" && pending;

  return (
    <div
      className={`login-wrap ${phase === "intro" ? "is-intro" : "is-ready"}${showKeys ? " is-keys" : ""}`}
    >
      <Link href="/" className="login-back">
        <Icon name="arrowLeft" size={14} />
        Back to site
      </Link>

      {phase === "intro" && (
        <button type="button" className="login-skip" onClick={() => setPhase("ready")}>
          Skip
        </button>
      )}

      <div className="login-stage" aria-hidden={!showVault}>
        <VaultDoor playing={showVault} />
      </div>

      <div className="login-reveal" aria-hidden={showVault}>
        <div className="login-brand-beat">
          <ABLockup size={showKeys ? 140 : 180} tone="#fff" />
        </div>

        {showLogin && (
          <div className="login-card">
            <p className="login-sub">
              Paste a guardian key if you already have one, or start a demo org with sample money and
              two agents ready to try.
            </p>
            <div className="field">
              <label>Guardian key</label>
              <input
                placeholder="pv_guardian_…"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && key.trim() && void connect()}
                autoFocus
              />
            </div>
            <button
              style={{ width: "100%" }}
              disabled={busy || !key.trim()}
              onClick={() => void connect()}
            >
              Open console
            </button>
            <div className="or">or</div>
            <Button
              variant="ghost"
              style={{ width: "100%" }}
              disabled={busy}
              onClick={() => void bootstrap()}
            >
              Launch demo org with $100 float
            </Button>
            <p className="faint" style={{ fontSize: 11.5, marginTop: 20, lineHeight: 1.6 }}>
              The demo resets local data and creates a fresh org with two agents. Not a bank. Not FDIC
              insured.
            </p>
          </div>
        )}

        {showKeys && pending && (
          <KeyRevealCard
            session={pending}
            savedAck={savedAck}
            setSavedAck={setSavedAck}
            copied={copied}
            busy={busy}
            onCopy={onCopy}
            onDownload={() => {
              downloadKeysFile(pending);
              setToast("Downloaded keys markdown file", "ok");
            }}
            onEnter={enterConsole}
          />
        )}
      </div>
    </div>
  );
}

function KeyRevealCard({
  session,
  savedAck,
  setSavedAck,
  copied,
  busy,
  onCopy,
  onDownload,
  onEnter,
}: {
  session: Session;
  savedAck: boolean;
  setSavedAck: (v: boolean) => void;
  copied: string | null;
  busy: boolean;
  onCopy: (label: string, text: string) => void;
  onDownload: () => void;
  onEnter: () => void;
}) {
  return (
    <div className="login-card login-card-keys">
      <div className="login-keys-head">
        <span className="login-keys-badge">
          <Icon name="key" size={14} />
          Save these keys
        </span>
        <h2 className="login-keys-title">Your org credentials</h2>
        <p className="login-sub" style={{ marginBottom: 0 }}>
          Shown once. Copy them or download the file — we only store hashes on the server, so we
          cannot email these back later.
        </p>
      </div>

      <SecretRow
        label="Guardian key"
        hint="Root access — approve spend, change policy"
        value={session.guardianKey}
        copied={copied === "Guardian key"}
        onCopy={() => void onCopy("Guardian key", session.guardianKey)}
      />

      {session.agentKeys.map((a) => (
        <SecretRow
          key={a.agentId}
          label={`${a.name} API key`}
          hint={`Agent id ${a.agentId}`}
          value={a.key}
          copied={copied === `${a.name} API key`}
          onCopy={() => void onCopy(`${a.name} API key`, a.key)}
        />
      ))}

      <div className="login-keys-toolbar">
        <Button
          variant="ghost"
          style={{ flex: 1 }}
          disabled={busy}
          onClick={() =>
            void onCopy(
              "all keys",
              [
                `Guardian: ${session.guardianKey}`,
                ...session.agentKeys.map((a: AgentKey) => `${a.name}: ${a.key}`),
              ].join("\n"),
            )
          }
        >
          <Icon name="copy" size={14} />
          Copy all
        </Button>
        <Button variant="ghost" style={{ flex: 1 }} disabled={busy} onClick={onDownload}>
          <Icon name="download" size={14} />
          Download .md
        </Button>
      </div>

      <label className="login-keys-ack">
        <input
          type="checkbox"
          checked={savedAck}
          onChange={(e) => setSavedAck(e.target.checked)}
        />
        <span>I’ve saved these keys in a password manager or the downloaded file.</span>
      </label>

      <button style={{ width: "100%" }} disabled={busy || !savedAck} onClick={onEnter}>
        Enter console
      </button>
      <p className="faint" style={{ fontSize: 11.5, marginTop: 14, lineHeight: 1.6 }}>
        Clearing this site’s browser data signs you out. You’ll need the guardian key to get back
        in — or launch a new demo org (that resets the float).
      </p>
    </div>
  );
}

function SecretRow({
  label,
  hint,
  value,
  copied,
  onCopy,
}: {
  label: string;
  hint: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="login-secret">
      <div className="login-secret-meta">
        <div>
          <div className="login-secret-label">{label}</div>
          <div className="login-secret-hint">{hint}</div>
        </div>
        <button type="button" className="login-secret-copy" onClick={onCopy}>
          <Icon name={copied ? "check" : "copy"} size={14} />
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <code className="login-secret-value">{value}</code>
    </div>
  );
}

/**
 * Glass-steel hexagonal vault — same language as the AB mark and console:
 * cool greys, soft blue accent rim, dial + bolts. No olive/green cast.
 */
function VaultDoor({ playing }: { playing: boolean }) {
  return (
    <div className={`vault ${playing ? "is-playing" : ""}`}>
      <div className="vault-glow" aria-hidden />
      <div className="vault-scene">
        <svg className="vault-svg vault-frame-svg" viewBox="0 0 240 240" aria-hidden>
          <defs>
            <linearGradient id="vault-steel" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#3a3a44" />
              <stop offset="42%" stopColor="#1a1a20" />
              <stop offset="100%" stopColor="#0c0c10" />
            </linearGradient>
            <linearGradient id="vault-rim" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#8e8e99" />
              <stop offset="100%" stopColor="#3a3a42" />
            </linearGradient>
            <linearGradient id="vault-accent" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#60a5fa" />
              <stop offset="100%" stopColor="#2563eb" />
            </linearGradient>
          </defs>
          <polygon
            points="120,18 198,62 198,178 120,222 42,178 42,62"
            fill="url(#vault-steel)"
            stroke="url(#vault-rim)"
            strokeWidth="5.5"
            strokeLinejoin="round"
          />
          <polygon
            points="120,34 184,70 184,170 120,206 56,170 56,70"
            fill="none"
            stroke="url(#vault-accent)"
            strokeWidth="1.75"
            strokeLinejoin="round"
            opacity="0.55"
          />
          <rect className="vault-hinge" x="192" y="88" width="9" height="15" rx="2" fill="#c8c8d0" />
          <rect className="vault-hinge" x="192" y="112" width="9" height="15" rx="2" fill="#c8c8d0" />
          <rect className="vault-hinge" x="192" y="136" width="9" height="15" rx="2" fill="#c8c8d0" />
        </svg>

        <div className="vault-door-pivot">
          <div className="vault-door-face">
            <svg className="vault-svg" viewBox="0 0 240 240" aria-hidden>
              <defs>
                <linearGradient id="vault-dial-accent" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#60a5fa" />
                  <stop offset="100%" stopColor="#2563eb" />
                </linearGradient>
              </defs>
              <polygon
                points="120,38 180,72 180,168 120,202 60,168 60,72"
                fill="#141418"
                stroke="rgba(255,255,255,0.12)"
                strokeWidth="2.5"
                strokeLinejoin="round"
              />
              <g className="vault-bolts" fill="#24242c" stroke="#9a9aa3" strokeWidth="1.4">
                {[0, 60, 120, 180, 240, 300].map((deg, i) => (
                  <g key={deg} transform={`rotate(${deg} 120 120)`}>
                    <rect
                      className="vault-bolt-bar"
                      style={{ animationDelay: `${2.05 + i * 0.05}s` }}
                      x="112"
                      y="48"
                      width="16"
                      height="44"
                      rx="4"
                    />
                  </g>
                ))}
              </g>
              <g className="vault-dial">
                <circle cx="120" cy="120" r="36" fill="#1c1c22" stroke="#6b6b76" strokeWidth="2.5" />
                <circle
                  cx="120"
                  cy="120"
                  r="26"
                  fill="none"
                  stroke="url(#vault-dial-accent)"
                  strokeWidth="1.75"
                  opacity="0.75"
                />
                {Array.from({ length: 12 }).map((_, i) => {
                  const a = ((i * 30 - 90) * Math.PI) / 180;
                  const x = 120 + Math.cos(a) * 30;
                  const y = 120 + Math.sin(a) * 30;
                  return (
                    <rect
                      key={i}
                      x={x - 2}
                      y={y - 4.5}
                      width="4"
                      height="9"
                      rx="1.5"
                      fill="#c8c8d0"
                      transform={`rotate(${i * 30} ${x} ${y})`}
                    />
                  );
                })}
                <circle cx="120" cy="120" r="9" fill="#0a0a0c" stroke="#e8e8ec" strokeWidth="1.75" />
                <line
                  x1="120"
                  y1="120"
                  x2="120"
                  y2="99"
                  stroke="#f4f4f6"
                  strokeWidth="2.25"
                  strokeLinecap="round"
                />
              </g>
            </svg>
          </div>
        </div>
      </div>
      <p className="vault-caption">Opening vault…</p>
    </div>
  );
}
