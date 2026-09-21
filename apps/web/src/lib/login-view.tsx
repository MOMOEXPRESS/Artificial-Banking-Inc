"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ABLockup } from "./brand";
import { Icon } from "./ui";
import type { AgentKey, Session } from "./console-types";
import { Button } from "@/components/ui/button";

const API = process.env.NEXT_PUBLIC_API_URL ?? "/abi-api";

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

function keysMarkdown(session: Session, kind: "real" | "demo"): string {
  const when = new Date().toISOString();
  const agents = session.agentKeys
    .map((a) => `### ${a.name}\n\n\`${a.key}\`\n\nAgent id: \`${a.agentId}\``)
    .join("\n\n");
  return `# Artificial Banking — org keys

Generated: ${when}
${session.orgId ? `Org id: \`${session.orgId}\`` : ""}
Kind: ${kind === "demo" ? "demo bootstrap (destructive wipe)" : "real organization"}

Treat these like root passwords. Anyone with the guardian key can approve spend and change policy.
We cannot show them again from the server — only a hash is stored.

## Guardian key

\`${session.guardianKey}\`

## Agent API keys

${
  agents ||
  "_No agents yet._ Create them in Console → Agents, then save each `pv_agent_…` key once."
}

---

Not a bank. Not FDIC insured. ${
    kind === "demo"
      ? "Demo float is sample ledger money unless you fund the vault yourself."
      : "Fund the vault with real network USDC (and ETH for gas) before agents can pay on-chain."
  }
`;
}

function downloadKeysFile(session: Session, kind: "real" | "demo") {
  const body = keysMarkdown(session, kind);
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

type Phase = "ready" | "keys";
type LoginMode = "signin" | "signup" | "key" | "demo" | "reset";
type ApiStatus =
  | { state: "checking" | "ready" }
  | {
      state: "error";
      code: string;
      message: string;
      setup?: { missing?: string; where?: string; example?: string; docs?: string };
    };

export function Login({
  onLogin,
  setToast,
}: {
  onLogin: (s: Session) => void;
  setToast: (m: string, k?: "ok" | "err" | "info") => void;
}) {
  const [key, setKey] = useState("");
  const [apiStatus, setApiStatus] = useState<ApiStatus>({ state: "checking" });
  const [orgName, setOrgName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [inviteToken, setInviteToken] = useState("");
  const [mode, setMode] = useState<LoginMode>("signin");
  /**
   * Password reset. The API and the emailed link already existed; there was no
   * way to ask for one, so a forgotten password meant a lost organization for
   * anyone without database access.
   */
  const [resetSent, setResetSent] = useState<string | null>(null);
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");

  // The emailed link lands on /console?reset=<token>. Without this the link
  // opened a normal sign-in screen and the token was silently ignored.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const token = new URLSearchParams(window.location.search).get("reset");
    if (token) {
      setResetToken(token);
      setMode("reset");
    }
  }, []);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<Phase>("ready");
  const [pending, setPending] = useState<Session | null>(null);
  const [pendingKind, setPendingKind] = useState<"real" | "demo">("real");
  const [savedAck, setSavedAck] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(null), 1600);
    return () => window.clearTimeout(t);
  }, [copied]);

  const checkApi = useCallback(async () => {
    setApiStatus({ state: "checking" });
    try {
      const res = await fetch(`${API}/health`, {
        credentials: "include",
        cache: "no-store",
      });
      if (res.ok) {
        setApiStatus({ state: "ready" });
        return;
      }
      const payload = (await res.json().catch(() => null)) as
        | {
            error?: {
              code?: string;
              message?: string;
              setup?: { missing?: string; where?: string; example?: string; docs?: string };
            };
          }
        | null;
      setApiStatus({
        state: "error",
        code: payload?.error?.code ?? `HTTP_${res.status}`,
        message: payload?.error?.message ?? `The ABI API returned HTTP ${res.status}.`,
        setup: payload?.error?.setup,
      });
    } catch {
      setApiStatus({
        state: "error",
        code: "API_UNREACHABLE",
        message: "The console could not reach the ABI API. Check the API service and try again.",
      });
    }
  }, []);

  useEffect(() => {
    void checkApi();
  }, [checkApi]);

  async function connect() {
    setBusy(true);
    try {
      const res = await fetch(`${API}/v1/guardian/org`, {
        headers: { Authorization: `Bearer ${key.trim()}` },
      });
      if (!res.ok) throw new Error(await readApiError(res));
      const data = await res.json();
      onLogin({ mode: "key", guardianKey: key.trim(), orgId: data.org.id, agentKeys: [] });
    } catch (e) {
      setToast(`Connect failed: ${String(e)}`, "err");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Sign in with an account. The credential is an httpOnly cookie the server
   * sets — nothing sensitive reaches localStorage, unlike the bearer-key path.
   */
  async function signIn() {
    setBusy(true);
    try {
      const res = await fetch(`${API}/v1/auth/login`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      if (!res.ok) throw new Error(await readApiError(res));
      const d = (await res.json()) as {
        user: { id: string; email: string; name: string };
        orgs: { id: string; name: string; role: string }[];
      };
      if (!d.orgs.length) {
        throw new Error("This account is not a member of any organization yet.");
      }
      onLogin({
        mode: "session",
        guardianKey: "",
        orgId: d.orgs[0].id,
        user: d.user,
        agentKeys: [],
      });
    } catch (e) {
      setToast(`Sign in failed: ${String(e)}`, "err");
    } finally {
      setBusy(false);
    }
  }

  async function requestReset() {
    if (!email.trim()) {
      setToast("Enter your email address first.", "err");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${API}/v1/auth/password-reset/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const d = (await res.json()) as { devResetToken?: string; note?: string };
      // The endpoint answers 200 whether or not the address exists, so it
      // cannot be used to enumerate accounts. Say the same thing back.
      setResetSent(
        d.devResetToken
          ? `Email is not configured, so here is the link: ${window.location.origin}/console?reset=${d.devResetToken}`
          : (d.note ?? "If that address has an account, a reset link is on its way."),
      );
    } catch (e) {
      setToast(`Could not request a reset: ${String(e)}`, "err");
    } finally {
      setBusy(false);
    }
  }

  async function confirmReset() {
    setBusy(true);
    try {
      const res = await fetch(`${API}/v1/auth/password-reset/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: resetToken, newPassword }),
      });
      if (!res.ok) throw new Error(await readApiError(res));
      setNewPassword("");
      setResetToken("");
      setMode("signin");
      // Confirming also revokes every session for that user, so signing in
      // again is the required next step rather than an inconvenience.
      setToast("Password updated. Sign in with the new one.", "ok");
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.delete("reset");
        window.history.replaceState(null, "", url.toString());
      }
    } catch (e) {
      setToast(`Reset failed: ${String(e)}`, "err");
    } finally {
      setBusy(false);
    }
  }

  /** Create an account. With an invite token, joins that org instead of a new one. */
  async function signUp() {
    setBusy(true);
    try {
      const res = await fetch(`${API}/v1/auth/signup`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          name: fullName.trim() || email.trim().split("@")[0],
          password,
          ...(inviteToken.trim()
            ? { invitationToken: inviteToken.trim() }
            : { orgName: orgName.trim() || undefined }),
        }),
      });
      if (!res.ok) throw new Error(await readApiError(res));
      const d = (await res.json()) as {
        user: { id: string; email: string; name: string };
        org: { id: string; role: string };
      };
      onLogin({
        mode: "session",
        guardianKey: "",
        orgId: d.org.id,
        user: d.user,
        agentKeys: [],
      });
      setToast(`Welcome. You are ${d.org.role} of this organization.`, "ok");
    } catch (e) {
      setToast(`Sign up failed: ${String(e)}`, "err");
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
        mode: "key",
        guardianKey: d.guardianKey,
        orgId: d.orgId,
        agentKeys: [
          { agentId: d.researcherAgentId, name: "Researcher", key: d.agentApiKey },
          { agentId: d.writerAgentId, name: "Writer", key: d.writerApiKey },
        ],
      };
      setPending(session);
      setPendingKind("demo");
      setSavedAck(false);
      setCopied(null);
      setPhase("keys");
      setToast("Demo org created — save your keys before entering the console.", "ok");
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

  const showLogin = phase === "ready";
  const showKeys = phase === "keys" && pending;

  if (showLogin && apiStatus.state === "error") {
    return (
      <div className="login-wrap is-ready">
        <Link href="/" className="login-back">
          <Icon name="arrowLeft" size={14} />
          Back to site
        </Link>
        <div className="login-reveal">
          <div className="login-brand-beat">
            <ABLockup size={180} tone="#fff" />
          </div>
          <div className="login-card">
            <span className="pill bad" style={{ marginBottom: 16 }}>
              <i /> Service unavailable
            </span>
            <h1 style={{ margin: "0 0 10px", fontSize: 24 }}>Console setup required</h1>
            <p className="login-sub">{apiStatus.message}</p>
            {apiStatus.setup?.missing ? (
              <div
                style={{
                  padding: 14,
                  marginBottom: 16,
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  fontSize: 12,
                  lineHeight: 1.65,
                }}
              >
                <div>
                  Missing: <code>{apiStatus.setup.missing}</code>
                </div>
                {apiStatus.setup.where ? <div>Configure it in {apiStatus.setup.where}.</div> : null}
                {apiStatus.setup.example ? (
                  <div>
                    Example: <code>{apiStatus.setup.example}</code>
                  </div>
                ) : null}
              </div>
            ) : null}
            <Button style={{ width: "100%" }} onClick={() => void checkApi()}>
              Try again
            </Button>
            <p className="faint" style={{ fontSize: 11.5, marginTop: 14, lineHeight: 1.55 }}>
              Error code: <code>{apiStatus.code}</code>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`login-wrap is-ready${showKeys ? " is-keys" : ""}`}>
      <Link href="/" className="login-back">
        <Icon name="arrowLeft" size={14} />
        Back to site
      </Link>

      <div className="login-reveal">
        <div className="login-brand-beat">
          <ABLockup size={showKeys ? 140 : 180} tone="#fff" />
        </div>

        {showLogin && (
          <div className="login-card">
            <p className="login-sub">
              Policy-controlled USDC wallets for AI agents. Sign in with your account, or create
              one — agent API keys are issued separately, inside the console.
            </p>

            <div className="login-mode-row" role="tablist" aria-label="How to enter">
              {(
                [
                  ["signin", "Sign in"],
                  ["signup", "Create account"],
                  ["key", "Use a key"],
                  ["demo", "Demo"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={mode === id}
                  className={`login-mode-btn ${mode === id ? "on" : ""}`}
                  disabled={busy}
                  onClick={() => setMode(id)}
                >
                  {label}
                </button>
              ))}
            </div>

            {mode === "signin" && (
              <>
                <div className="field">
                  <label>Email</label>
                  <input
                    type="email"
                    autoComplete="username"
                    placeholder="you@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="field">
                  <label>Password</label>
                  <input
                    type="password"
                    autoComplete="current-password"
                    placeholder="••••••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && email.trim() && password && void signIn()}
                  />
                </div>
                <button
                  style={{ width: "100%" }}
                  disabled={busy || !email.trim() || !password}
                  onClick={() => void signIn()}
                >
                  Sign in
                </button>
                <button
                  className="bare"
                  style={{ fontSize: 11.5, marginTop: 12 }}
                  disabled={busy}
                  onClick={() => void requestReset()}
                >
                  Forgot your password?
                </button>
                {resetSent && (
                  <p className="faint" style={{ fontSize: 11.5, marginTop: 8, lineHeight: 1.55 }}>
                    {resetSent}
                  </p>
                )}
                <p className="faint" style={{ fontSize: 11.5, marginTop: 14, lineHeight: 1.55 }}>
                  Your session is a secure cookie, not a key pasted into the browser. Sign out
                  anywhere and it stops working.
                </p>
              </>
            )}

            {mode === "reset" && (
              <>
                <p className="faint" style={{ fontSize: 12.5, lineHeight: 1.6, marginTop: 0 }}>
                  Choose a new password. Every existing session for this account is signed out.
                </p>
                <div className="field">
                  <label>New password</label>
                  <input
                    type="password"
                    autoComplete="new-password"
                    placeholder="••••••••••••"
                    value={newPassword}
                    autoFocus
                    onChange={(e) => setNewPassword(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && newPassword && void confirmReset()}
                  />
                </div>
                <button
                  style={{ width: "100%" }}
                  disabled={busy || !newPassword || !resetToken}
                  onClick={() => void confirmReset()}
                >
                  Set new password
                </button>
                <button
                  className="bare"
                  style={{ fontSize: 11.5, marginTop: 12 }}
                  onClick={() => setMode("signin")}
                >
                  Back to sign in
                </button>
              </>
            )}

            {mode === "signup" && (
              <>
                <div className="field">
                  <label>Email</label>
                  <input
                    type="email"
                    autoComplete="username"
                    placeholder="you@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="field">
                  <label>Your name</label>
                  <input
                    autoComplete="name"
                    placeholder="Alex Doe"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label>Password</label>
                  <input
                    type="password"
                    autoComplete="new-password"
                    placeholder="at least 12 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                {inviteToken.trim() ? null : (
                  <div className="field">
                    <label>Organization name</label>
                    <input
                      placeholder="Acme Ops"
                      value={orgName}
                      onChange={(e) => setOrgName(e.target.value)}
                    />
                  </div>
                )}
                <div className="field">
                  <label>Invitation token (optional)</label>
                  <input
                    placeholder="paste to join an existing org instead"
                    value={inviteToken}
                    onChange={(e) => setInviteToken(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && email.trim() && password && void signUp()}
                  />
                </div>
                <button
                  style={{ width: "100%" }}
                  disabled={busy || !email.trim() || !password}
                  onClick={() => void signUp()}
                >
                  {inviteToken.trim() ? "Join organization" : "Create account & organization"}
                </button>
                <p className="faint" style={{ fontSize: 11.5, marginTop: 14, lineHeight: 1.55 }}>
                  Starts empty: no demo agents, no sample stipend. You add agents and fund the vault
                  yourself.
                </p>
              </>
            )}

            {mode === "key" && (
              <>
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
              </>
            )}

            {mode === "demo" && (
              <>
                <Button
                  variant="ghost"
                  style={{ width: "100%" }}
                  disabled={busy}
                  onClick={() => void bootstrap()}
                >
                  Launch demo org with $100 float
                </Button>
                <p className="faint" style={{ fontSize: 11.5, marginTop: 14, lineHeight: 1.55 }}>
                  Resets local data and seeds Researcher + Writer with sample money. Side path for
                  trying the rails — not your production org.
                </p>
              </>
            )}

            <p className="faint" style={{ fontSize: 11.5, marginTop: 20, lineHeight: 1.6 }}>
              Not a bank. Not FDIC insured.
            </p>
          </div>
        )}

        {showKeys && pending && (
          <KeyRevealCard
            session={pending}
            kind={pendingKind}
            savedAck={savedAck}
            setSavedAck={setSavedAck}
            copied={copied}
            busy={busy}
            onCopy={onCopy}
            onDownload={() => {
              downloadKeysFile(pending, pendingKind);
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
  kind,
  savedAck,
  setSavedAck,
  copied,
  busy,
  onCopy,
  onDownload,
  onEnter,
}: {
  session: Session;
  kind: "real" | "demo";
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
        <h2 className="login-keys-title">
          {kind === "real" ? "Your organization credentials" : "Your demo credentials"}
        </h2>
        <p className="login-sub" style={{ marginBottom: 0 }}>
          Shown once. Copy them or download the file — we only store hashes on the server, so we
          cannot email these back later.
          {kind === "real"
            ? " No agents yet — create them in the console and save each agent key when it appears."
            : ""}
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

      {session.agentKeys.length === 0 ? (
        <p className="faint" style={{ fontSize: 12, lineHeight: 1.5, margin: "4px 0 0" }}>
          Next inside the console: <b>Agents → Create</b>, then Treasury (fund vault + stipend),
          then connect your agent runtime with the new <code>pv_agent_…</code> key.
        </p>
      ) : null}

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
        in
        {kind === "demo" ? " — or launch a new demo org (that resets the float)." : "."}
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
