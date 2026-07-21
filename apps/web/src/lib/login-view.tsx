"use client";
import { useState } from "react";
import { ABLockup } from "./brand";
import { Icon } from "./ui";
import type { Session } from "./console-types";
import { Button } from "@/components/ui/button";

const API = process.env.NEXT_PUBLIC_API_URL ?? "/abi-api";

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
      if (!res.ok) throw new Error(`Key rejected (HTTP ${res.status})`);
      const data = await res.json();
      onLogin({ guardianKey: key.trim(), orgId: data.org.id, agentKeys: [] });
    } catch (e) {
      setToast(`Connect failed: ${String(e)}. Is the API running on ${API}?`, "err");
    } finally {
      setBusy(false);
    }
  }

  async function bootstrap() {
    setBusy(true);
    try {
      const res = await fetch(`${API}/v1/demo/bootstrap`, { method: "POST" });
      const d = await res.json();
      onLogin({
        guardianKey: d.guardianKey,
        orgId: d.orgId,
        agentKeys: [
          { agentId: d.researcherAgentId, name: "Researcher", key: d.agentApiKey },
          { agentId: d.writerAgentId, name: "Writer", key: d.writerApiKey },
        ],
      });
    } catch (e) {
      setToast(`Bootstrap failed: ${String(e)}. Is the API running on ${API}?`, "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="brand" style={{ flexDirection: "column", gap: 14 }}>
          <ABLockup size={56} tone="#fff" />
        </div>
        <p className="login-sub">
          Financial infrastructure for autonomous AI. Programmable wallets, spending policies and
          human approvals — the authorization layer between your agents and real money.
        </p>
        <ul className="login-points">
          <li>
            <Icon name="shield" /> Hard budgets, allowlists and a one-tap kill switch
          </li>
          <li>
            <Icon name="check" /> Anything large parks and waits for your approval
          </li>
          <li>
            <Icon name="swap" /> Escrowed agent-to-agent hiring over real x402 payments
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
          The demo wipes the local database and seeds a fresh org with two agents and keys loaded
          into the Playground. Not a bank. Not FDIC insured.
        </p>
      </div>
    </div>
  );
}

