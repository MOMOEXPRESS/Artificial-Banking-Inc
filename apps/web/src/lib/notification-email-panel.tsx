"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { okJson } from "./api-response";

type Settings = {
  email: string | null;
  emailEnabled: boolean;
  ownerEmail: string | null;
  effectiveRecipient: string | null;
};

/** Settings → Notifications: who gets notification email (defaults to the owner). */
export function NotificationEmailPanel({
  gFetch,
  act,
  busy,
  canEdit,
}: {
  gFetch: (p: string, i?: RequestInit) => Promise<Response>;
  act: (label: string, fn: () => Promise<string | void>) => Promise<void>;
  busy: boolean;
  canEdit: boolean;
}) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [email, setEmail] = useState("");

  useEffect(() => {
    let live = true;
    void (async () => {
      const d = await okJson(await gFetch("/v1/guardian/notification-settings"));
      if (live && d?.settings) {
        setSettings(d.settings as Settings);
        setEmail((d.settings as Settings).email ?? "");
      }
    })();
    return () => {
      live = false;
    };
  }, [gFetch]);

  const save = (patch: { email?: string | null; emailEnabled?: boolean }) =>
    act("Save notification email", async () => {
      const r = await gFetch("/v1/guardian/notification-settings", {
        method: "PUT",
        body: JSON.stringify(patch),
      });
      const d = await okJson(r);
      if (!d?.settings) throw new Error("Could not save notification email.");
      setSettings(d.settings as Settings);
      return "Notification email saved.";
    });

  return (
    <div className="card" data-testid="notification-email-panel">
      <div className="card-head">
        <div>
          <h2>Notification email</h2>
          <div className="sub">
            Failed payments, refusals, approvals, frozen agents, revoked keys and treasury moves are
            emailed here. Everything else stays in the bell.
          </div>
        </div>
      </div>
      <div className="between settings-setting-row">
        <div style={{ minWidth: 0, paddingRight: 14 }}>
          <b style={{ fontSize: 13, display: "block" }}>Email important notifications</b>
          <span className="muted" style={{ fontSize: 12, lineHeight: 1.55 }}>
            {settings?.effectiveRecipient
              ? `Sending to ${settings.effectiveRecipient}.`
              : "No recipient yet — add one below."}
          </span>
        </div>
        <button
          className={`switch ${settings?.emailEnabled ? "on" : ""}`}
          disabled={!canEdit || busy || !settings}
          onClick={() => void save({ emailEnabled: !settings?.emailEnabled })}
          aria-label="Toggle notification email"
        />
      </div>
      <div className="settings-setting-row" style={{ display: "flex", gap: 8 }}>
        <input
          className="input"
          type="email"
          placeholder={
            settings?.ownerEmail ? `Default: ${settings.ownerEmail}` : "alerts@company.com"
          }
          value={email}
          disabled={!canEdit}
          onChange={(e) => setEmail(e.target.value)}
          style={{ flex: 1 }}
        />
        <Button
          size="sm"
          disabled={!canEdit || busy}
          onClick={() => void save({ email: email.trim() ? email.trim() : null })}
        >
          Save
        </Button>
      </div>
    </div>
  );
}
