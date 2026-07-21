"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ABLockup } from "./brand";
import { Icon } from "./ui";
import type { Session } from "./console-types";
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

type Phase = "intro" | "ready";

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

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setPhase("ready");
      return;
    }
    const t = window.setTimeout(() => setPhase("ready"), INTRO_MS);
    return () => window.clearTimeout(t);
  }, []);

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
      setToast(`Connect failed: ${String(e)}. Is the API reachable via ${API}?`, "err");
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
      onLogin({
        guardianKey: d.guardianKey,
        orgId: d.orgId,
        agentKeys: [
          { agentId: d.researcherAgentId, name: "Researcher", key: d.agentApiKey },
          { agentId: d.writerAgentId, name: "Writer", key: d.writerApiKey },
        ],
      });
    } catch (e) {
      setToast(`Bootstrap failed: ${String(e)}. Is the API reachable via ${API}?`, "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`login-wrap ${phase === "ready" ? "is-ready" : "is-intro"}`}>
      <Link href="/" className="login-back">
        <Icon name="arrowLeft" size={14} />
        Back to site
      </Link>

      {phase === "intro" && (
        <button type="button" className="login-skip" onClick={() => setPhase("ready")}>
          Skip
        </button>
      )}

      <div className="login-stage" aria-hidden={phase === "ready"}>
        <VaultDoor playing={phase === "intro"} />
      </div>

      <div className="login-reveal" aria-hidden={phase !== "ready"}>
        <div className="login-brand-beat">
          <ABLockup size={180} tone="#fff" />
        </div>
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
              disabled={phase !== "ready"}
              autoFocus={phase === "ready"}
            />
          </div>
          <button
            style={{ width: "100%" }}
            disabled={busy || !key.trim() || phase !== "ready"}
            onClick={() => void connect()}
          >
            Open console
          </button>
          <div className="or">or</div>
          <Button
            variant="ghost"
            style={{ width: "100%" }}
            disabled={busy || phase !== "ready"}
            onClick={() => void bootstrap()}
          >
            Launch demo org with $100 float
          </Button>
          <p className="faint" style={{ fontSize: 11.5, marginTop: 20, lineHeight: 1.6 }}>
            The demo resets local data and creates a fresh org with two agents. Not a bank. Not FDIC
            insured.
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Hexagonal vault — dial spins, bolts retract, door swings open on the hinges.
 * Visual language matches the brand vault mark (hex + dial + hinge blocks).
 */
function VaultDoor({ playing }: { playing: boolean }) {
  return (
    <div className={`vault ${playing ? "is-playing" : ""}`}>
      <div className="vault-glow" />
      <div className="vault-scene">
        {/* Outer fixed frame (stays) */}
        <svg className="vault-svg vault-frame-svg" viewBox="0 0 240 240" aria-hidden>
          <defs>
            <linearGradient id="vault-steel" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#3a3a42" />
              <stop offset="45%" stopColor="#1c1c22" />
              <stop offset="100%" stopColor="#0e0e12" />
            </linearGradient>
            <linearGradient id="vault-rim" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#6a6a74" />
              <stop offset="100%" stopColor="#2a2a32" />
            </linearGradient>
          </defs>
          <polygon
            className="vault-hex-outer"
            points="120,18 198,62 198,178 120,222 42,178 42,62"
            fill="url(#vault-steel)"
            stroke="url(#vault-rim)"
            strokeWidth="6"
            strokeLinejoin="round"
          />
          <polygon
            points="120,34 184,70 184,170 120,206 56,170 56,70"
            fill="none"
            stroke="#5a6b4a"
            strokeWidth="2.5"
            strokeLinejoin="round"
            opacity="0.85"
          />
          {/* Hinge blocks on the right — suggest the swing axis */}
          <rect className="vault-hinge" x="192" y="88" width="10" height="16" rx="2" fill="#c8c8d0" />
          <rect className="vault-hinge" x="192" y="112" width="10" height="16" rx="2" fill="#c8c8d0" />
          <rect className="vault-hinge" x="192" y="136" width="10" height="16" rx="2" fill="#c8c8d0" />
        </svg>

        {/* Swinging door face */}
        <div className="vault-door-pivot">
          <div className="vault-door-face">
            <svg className="vault-svg" viewBox="0 0 240 240" aria-hidden>
              <polygon
                points="120,38 180,72 180,168 120,202 60,168 60,72"
                fill="#16161c"
                stroke="#2e2e36"
                strokeWidth="3"
                strokeLinejoin="round"
              />
              {/* Six locking bolts / spokes */}
              <g className="vault-bolts" fill="#2a2a32" stroke="#8a8a94" strokeWidth="1.5">
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
              {/* Combination dial */}
              <g className="vault-dial">
                <circle cx="120" cy="120" r="36" fill="#1e1e24" stroke="#6a6a74" strokeWidth="3" />
                <circle cx="120" cy="120" r="26" fill="none" stroke="#5a6b4a" strokeWidth="2" />
                {Array.from({ length: 12 }).map((_, i) => {
                  const a = ((i * 30 - 90) * Math.PI) / 180;
                  const x = 120 + Math.cos(a) * 30;
                  const y = 120 + Math.sin(a) * 30;
                  return (
                    <rect
                      key={i}
                      x={x - 2.5}
                      y={y - 5}
                      width="5"
                      height="10"
                      rx="2"
                      fill="#7a8f68"
                      transform={`rotate(${i * 30} ${x} ${y})`}
                    />
                  );
                })}
                <circle cx="120" cy="120" r="10" fill="#0a0a0c" stroke="#c8c8d0" strokeWidth="2" />
                <line x1="120" y1="120" x2="120" y2="98" stroke="#f4f4f6" strokeWidth="2.5" strokeLinecap="round" />
              </g>
            </svg>
          </div>
        </div>
      </div>
      <p className="vault-caption">Opening vault…</p>
    </div>
  );
}
