"use client";

/**
 * Where this organization's financial data may go (P8-T2, finding M4).
 *
 * The disclosure is rendered above the choice, not behind a tooltip or a link.
 * Consent to send balances and spend figures to a third party is not meaningful
 * if the person giving it has to go looking for what "AI assistant" means.
 */

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "./ui";

type AiMode = "off" | "platform" | "byo";

type AiSettings = {
  mode: AiMode;
  egressHost: string | null;
  model: string;
  hasOwnKey: boolean;
  baseUrl: string | null;
  note?: string;
};

const MODES: { value: AiMode; label: string; body: string }[] = [
  {
    value: "off",
    label: "Off",
    body:
      "Nothing leaves this platform. The assistant still answers from your own data — it is narrower, not broken.",
  },
  {
    value: "platform",
    label: "Use the operator's account",
    body:
      "Your data is sent to the model provider under the credential configured by whoever runs this deployment. Their vendor contract, not yours.",
  },
  {
    value: "byo",
    label: "Use your own account",
    body:
      "Your API key and endpoint, so the data goes to a vendor you contract with directly, in a region you choose.",
  },
];

export function AiEgressPanel({
  gFetch,
  act,
  locked,
}: {
  gFetch: (p: string, i?: RequestInit) => Promise<Response>;
  act: (label: string, fn: () => Promise<string | void>) => Promise<void>;
  locked: boolean;
}) {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [discloses, setDiscloses] = useState<string[]>([]);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await gFetch("/v1/guardian/settings/ai").then((r) => r.json());
      if (d.ai) {
        setSettings(d.ai);
        setBaseUrl(d.ai.baseUrl ?? "");
        setModel(d.ai.model ?? "");
      }
      setDiscloses(d.discloses ?? []);
    } finally {
      setLoaded(true);
    }
  }, [gFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = (patch: Record<string, unknown>, label: string) =>
    act("AI settings", async () => {
      const res = await gFetch("/v1/guardian/settings/ai", {
        method: "PUT",
        body: JSON.stringify(patch),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error?.message ?? JSON.stringify(d));
      setSettings(d.ai);
      setApiKey("");
      return label;
    });

  if (!loaded) return null;
  const mode = settings?.mode ?? "off";

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2 style={{ margin: 0 }}>AI assistant &amp; data egress</h2>
          <div className="sub">
            The assistant can reason over your treasury. Doing that means sending some of your
            financial data to a model provider. This is off unless you turn it on.
          </div>
        </div>
        <span className={`pill ${mode === "off" ? "ok" : "warn"}`}>
          <i /> {mode === "off" ? "nothing sent" : `sending to ${settings?.egressHost ?? "provider"}`}
        </span>
      </div>

      {discloses.length > 0 && (
        <div
          style={{
            padding: "12px 14px",
            borderRadius: 10,
            background: "var(--surface-3)",
            border: "1px solid var(--border)",
            marginBottom: 14,
          }}
        >
          <b style={{ fontSize: 12.5 }}>What gets sent when this is on</b>
          <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12.5, lineHeight: 1.7 }}>
            {discloses.map((line) => (
              <li key={line} className="faint">
                {line}
              </li>
            ))}
          </ul>
          <p className="faint" style={{ fontSize: 12, margin: "10px 0 0", lineHeight: 1.55 }}>
            Never sent: private keys, API keys, or anything that could move money. The assistant is
            read-only and cannot approve or send a payment.
          </p>
        </div>
      )}

      {settings?.note && (
        <div className="banner" style={{ marginBottom: 12 }}>
          <span className="ico">
            <Icon name="alert" size={16} />
          </span>
          <span className="txt">
            <b>Not currently active</b>
            <span>{settings.note}</span>
          </span>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {MODES.map((m) => (
          <label
            key={m.value}
            className="between"
            style={{
              gap: 12,
              alignItems: "flex-start",
              padding: "10px 12px",
              borderRadius: 10,
              border: `1px solid ${mode === m.value ? "var(--accent)" : "var(--border)"}`,
              cursor: locked ? "default" : "pointer",
            }}
          >
            <input
              type="radio"
              name="ai-mode"
              checked={mode === m.value}
              disabled={locked}
              style={{ marginTop: 3 }}
              onChange={() => {
                // byo needs a key before it can be selected, so the save is
                // deferred to the button below rather than firing on select.
                if (m.value === "byo") {
                  setSettings((s) => (s ? { ...s, mode: "byo" } : s));
                  return;
                }
                void save(
                  { mode: m.value },
                  m.value === "off"
                    ? "AI assistant off — nothing is sent off this platform."
                    : "AI assistant on, using the operator's model account.",
                );
              }}
            />
            <span style={{ flex: 1, minWidth: 0 }}>
              <b style={{ fontSize: 13 }}>{m.label}</b>
              <span className="faint" style={{ display: "block", fontSize: 12, lineHeight: 1.55 }}>
                {m.body}
              </span>
            </span>
          </label>
        ))}
      </div>

      {mode === "byo" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }}>
          <label style={{ fontSize: 12 }}>
            API key {settings?.hasOwnKey && <span className="faint">(stored — leave blank to keep)</span>}
            <input
              className="input sm"
              type="password"
              placeholder={settings?.hasOwnKey ? "••••••••" : "sk-…"}
              value={apiKey}
              disabled={locked}
              data-shortcut-ignore
              onChange={(e) => setApiKey(e.target.value)}
            />
          </label>
          <label style={{ fontSize: 12 }}>
            Endpoint <span className="faint">(https only — this is your data-residency lever)</span>
            <input
              className="input sm"
              placeholder="https://api.openai.com/v1"
              value={baseUrl}
              disabled={locked}
              data-shortcut-ignore
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </label>
          <label style={{ fontSize: 12 }}>
            Model
            <input
              className="input sm"
              placeholder="gpt-4o-mini"
              value={model}
              disabled={locked}
              data-shortcut-ignore
              onChange={(e) => setModel(e.target.value)}
            />
          </label>
          <div>
            <Button
              type="button"
              size="sm"
              disabled={locked || (!settings?.hasOwnKey && !apiKey.trim())}
              onClick={() =>
                void save(
                  {
                    mode: "byo",
                    ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
                    baseUrl: baseUrl.trim() || null,
                    model: model.trim() || null,
                  },
                  "Using your own model account.",
                )
              }
            >
              Save
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
