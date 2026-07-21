"use client";
import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ABLockup } from "./brand";
import { Icon } from "./ui";
import type { Session } from "./console-types";
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

export function Login({
  onLogin,
  setToast,
}: {
  onLogin: (s: Session) => void;
  setToast: (m: string, k?: "ok" | "err" | "info") => void;
}) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);

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
    <div className="login-wrap">
      <Link href="/" className="login-back">
        <Icon name="arrowLeft" size={14} />
        Back to site
      </Link>

      <div className="login-decor login-decor-a" aria-hidden>
        <Image src="/login/vault.png" alt="" width={160} height={160} className="login-decor-img" />
      </div>
      <div className="login-decor login-decor-b" aria-hidden>
        <Image src="/login/guardian.png" alt="" width={140} height={140} className="login-decor-img" />
      </div>

      <div className="login-card">
        <div className="brand" style={{ flexDirection: "column", gap: 14 }}>
          <ABLockup size={200} tone="#fff" />
        </div>
        <p className="login-sub">
          This is where you open the console. Paste a guardian key if you already have one, or start a
          demo org with sample money and two agents ready to try.
        </p>
        <ul className="login-points">
          <li>
            <Icon name="shield" /> Set budgets and block anything that shouldn&rsquo;t spend
          </li>
          <li>
            <Icon name="check" /> Big payments wait for a person to approve
          </li>
          <li>
            <Icon name="swap" /> Agents can pay APIs — under your rules
          </li>
        </ul>
        <div className="field">
          <label>Guardian key</label>
          <input
            placeholder="pv_guardian_…"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && key.trim() && void connect()}
          />
        </div>
        <button style={{ width: "100%" }} disabled={busy || !key.trim()} onClick={() => void connect()}>
          Open console
        </button>
        <div className="or">or</div>
        <Button variant="ghost" style={{ width: "100%" }} disabled={busy} onClick={() => void bootstrap()}>
          Launch demo org with $100 float
        </Button>
        <p className="faint" style={{ fontSize: 11.5, marginTop: 20, lineHeight: 1.6 }}>
          The demo resets local data and creates a fresh org with two agents. Keys land in the
          Playground so you can try it right away. Not a bank. Not FDIC insured.
        </p>
      </div>
    </div>
  );
}
