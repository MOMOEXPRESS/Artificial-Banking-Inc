"use client";
import { useState } from "react";
import { Empty, Icon, Stat, relTime } from "./ui";
import type { Shared, Webhook, Delivery } from "./console-types";
import { Button } from "@/components/ui/button";

export function Webhooks({
  webhooks,
  deliveries,
  busy,
  act,
  gFetch,
  readOnly,
}: Shared & { webhooks: Webhook[]; deliveries: Delivery[] }) {
  const locked = busy || readOnly;
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState<string | null>(null);

  const add = () =>
    act("Webhook", async () => {
      const res = await gFetch("/v1/guardian/webhooks", {
        method: "POST",
        body: JSON.stringify({ url: url.trim() }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error?.message ?? JSON.stringify(d));
      setSecret(d.secret);
      setUrl("");
      return "Endpoint registered — signing secret shown once below.";
    });

  const del = (id: string) =>
    act("Delete", async () => {
      await gFetch(`/v1/guardian/webhooks/${id}`, { method: "DELETE" });
      return "Endpoint removed.";
    });

  const test = (id: string) =>
    act("Test", async () => {
      const res = await gFetch(`/v1/guardian/webhooks/${id}/test`, { method: "POST" });
      if (!res.ok) throw new Error(JSON.stringify(await res.json()));
      return "Test event dispatched — watch the delivery table below.";
    });

  const rotate = (id: string) =>
    act("Rotate secret", async () => {
      const res = await gFetch(`/v1/guardian/webhooks/${id}/rotate`, { method: "POST", body: "{}" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error?.message ?? JSON.stringify(d));
      setSecret(d.secret);
      return "Webhook signing secret rotated — shown once below.";
    });

  const ok = deliveries.filter((d) => d.status === "delivered").length;
  const rate = deliveries.length ? Math.round((ok / deliveries.length) * 100) : 100;

  return (
    <>
      <div className="banner info" style={{ marginBottom: 14 }}>
        <span className="txt">
          <b>What webhooks do</b>
          <span>
            When money moves (paid, denied, needs your approval, escrow locked…), ABI POSTs signed
            JSON to a URL you control — Slack adapter, CRM, books — so you don&apos;t sit in the
            console. For a hands-on walkthrough, run Playground →{" "}
            <b>Webhook ping (ops notify)</b>.
          </span>
        </span>
      </div>
      <div className="grid g-4">
        <Stat label="Endpoints" value={String(webhooks.length)} foot="receiving money events" />
        <Stat label="Deliveries" value={String(deliveries.length)} foot="signed and retried 3×" />
        <Stat label="Success rate" value={`${rate}%`} foot={`${ok} delivered`} delta={{ dir: rate === 100 ? "up" : "down", text: `${rate}%` }} />
        <Stat
          label="Failed"
          value={String(deliveries.filter((d) => d.status === "failed").length)}
          foot="gave up after 3 attempts"
        />
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Endpoints</h2>
            <div className="sub">
              Every payment, denial, approval and escrow event POSTs here — HMAC-SHA256 signed.
            </div>
          </div>
          <div className="row">
            <input
              style={{ width: "100%", maxWidth: 300 }}
              placeholder="https://your-server/policyvault-hook"
              value={url}
              disabled={readOnly}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && url.trim() && void add()}
            />
            <Button size="sm" disabled={locked || !url.trim()} onClick={() => void add()}>
              <Icon name="plus" size={13} /> Add
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={locked || webhooks.some((w) => w.url === "abi://demo-inbox")}
              title="Built-in sink — no public URL; deliveries still show in the log"
              onClick={() => {
                setUrl("abi://demo-inbox");
                void act("Webhook", async () => {
                  const res = await gFetch("/v1/guardian/webhooks", {
                    method: "POST",
                    body: JSON.stringify({ url: "abi://demo-inbox" }),
                  });
                  const d = await res.json();
                  if (!res.ok) throw new Error(d.error?.message ?? JSON.stringify(d));
                  setSecret(d.secret);
                  setUrl("");
                  return "Demo inbox registered — Send test to see a delivery below.";
                });
              }}
            >
              Demo inbox
            </Button>
          </div>
        </div>
        {secret && (
          <div className="code" style={{ marginBottom: 14 }}>
            Signing secret (shown once) — verify <b style={{ color: "var(--text)" }}>x-policyvault-signature</b> with it:
            <div style={{ marginTop: 6, color: "var(--accent)" }}>{secret}</div>
            <Button variant="ghost" size="sm" style={{ marginTop: 9 }} onClick={() => setSecret(null)}>
              I saved it
            </Button>
          </div>
        )}
        {webhooks.length === 0 ? (
          <Empty icon="zap">
            No endpoints yet. Add one to stream every money event into your own systems.
          </Empty>
        ) : (
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>URL</th>
                  <th>Added</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {webhooks.map((w) => (
                  <tr key={w.id}>
                    <td className="mono">{w.url}</td>
                    <td className="faint mono">{relTime(w.createdAt)}</td>
                    <td>
                      <div className="row" style={{ flexWrap: "nowrap" }}>
                        <Button variant="ghost" size="sm" disabled={locked} onClick={() => void test(w.id)}>
                          Send test
                        </Button>
                        <Button variant="ghost" size="sm" disabled={locked} onClick={() => void rotate(w.id)}>
                          Rotate secret
                        </Button>
                        <Button variant="destructive" size="sm" disabled={locked} onClick={() => void del(w.id)}>
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card fill" style={{ display: "flex", flexDirection: "column" }}>
        <div className="card-head">
          <h2>Delivery log</h2>
        </div>
        {deliveries.length === 0 ? (
          <Empty icon="inbox">No deliveries yet.</Empty>
        ) : (
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Status</th>
                  <th className="num">Attempts</th>
                  <th>Error</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((d) => (
                  <tr key={d.id}>
                    <td className="mono">{d.event}</td>
                    <td>
                      <span
                        className={`pill ${
                          d.status === "delivered" ? "ok" : d.status === "pending" ? "warn" : "bad"
                        }`}
                      >
                        <i /> {d.status}
                      </span>
                    </td>
                    <td className="num mono">{d.attempts}</td>
                    <td className="muted wrap">{d.lastError ?? "—"}</td>
                    <td className="faint mono">{relTime(d.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

