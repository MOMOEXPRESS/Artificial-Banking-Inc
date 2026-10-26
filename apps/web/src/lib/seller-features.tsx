"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { sellerApiError, sellerApiFetch as apiFetch } from "./seller-api";
import { toast } from "./toast";

export type SellerOffer = {
  id: string;
  slug: string;
  title: string;
  endpointUrl: string;
  priceUsdc: string;
  network: string;
  status: "draft" | "verified" | "published" | "paused";
  version?: string;
  deprecatedAt?: string | null;
  sunsetAt?: string | null;
  successorOfferId?: string | null;
  directoryListed?: boolean;
  sandboxEnabled?: boolean;
  integration: {
    lastVerifiedAt: string | null;
    snippetVersion: string | null;
    error: string | null;
  };
};

type FeatureProps = {
  offers: SellerOffer[];
  onOffersChanged: () => Promise<void> | void;
};

const rowStyle = {
  padding: "12px 0",
  borderTop: "1px solid var(--color-border)",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap" as const,
};

const formGrid = {
  display: "grid",
  gap: 10,
  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
};

const preStyle = {
  whiteSpace: "pre-wrap" as const,
  fontSize: 12,
  background: "var(--color-surface-2)",
  padding: 14,
  borderRadius: 12,
  overflow: "auto",
  margin: 0,
};

function Card({
  title,
  children,
  actions,
}: {
  title?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="card">
      {(title || actions) && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          {title && <h3 style={{ marginTop: 0 }}>{title}</h3>}
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="card">
      <span className="muted">{label}</span>
      <b style={{ display: "block", marginTop: 6, fontSize: 20 }}>{value}</b>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="muted" style={{ margin: 0 }}>
      {children}
    </p>
  );
}

function Pill({
  tone,
  children,
}: {
  tone: "ok" | "warn" | "muted" | "danger";
  children: ReactNode;
}) {
  const colors: Record<string, string> = {
    ok: "var(--color-success, #1f9d55)",
    warn: "var(--color-warning, #b7791f)",
    danger: "var(--color-danger, #c53030)",
    muted: "var(--color-text-muted, #888)",
  };
  return (
    <span
      style={{
        fontSize: 11.5,
        padding: "2px 8px",
        borderRadius: 999,
        border: `1px solid ${colors[tone]}`,
        color: colors[tone],
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function Toggle({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        cursor: disabled ? "default" : "pointer",
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={label}
      />
      <span style={{ fontSize: 13 }}>{label}</span>
    </label>
  );
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function NoOffers() {
  return (
    <Card>
      <Empty>Create an offer in Catalog first.</Empty>
    </Card>
  );
}

async function patchOffer(offerId: string, patch: Record<string, unknown>): Promise<boolean> {
  const res = await apiFetch(`/v1/seller/offers/${offerId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    toast(await sellerApiError(res, "Could not update offer"), "err");
    return false;
  }
  return true;
}

// ---------------------------------------------------------------- directory

export function DirectoryView({ offers, onOffersChanged }: FeatureProps) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [publicIds, setPublicIds] = useState<Set<string>>(new Set());

  const loadPublic = useCallback(async () => {
    const res = await apiFetch("/v1/directory/offers").catch(() => null);
    if (!res?.ok) return;
    const body = (await res.json()) as { offers: { id: string }[] };
    setPublicIds(new Set(body.offers.map((o) => o.id)));
  }, []);

  useEffect(() => {
    void loadPublic();
  }, [loadPublic, offers]);

  async function setListed(offer: SellerOffer, listed: boolean) {
    setBusyId(offer.id);
    try {
      if (await patchOffer(offer.id, { directoryListed: listed })) {
        toast(listed ? "Listed in the buyer directory" : "Hidden from the buyer directory", "ok");
        await onOffersChanged();
      }
    } finally {
      setBusyId(null);
    }
  }

  if (offers.length === 0) return <NoOffers />;
  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 860 }}>
      <div
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
        }}
      >
        <Stat label="Live in directory" value={offers.filter((o) => publicIds.has(o.id)).length} />
        <Stat label="Opted out" value={offers.filter((o) => o.directoryListed === false).length} />
        <Stat
          label="Not yet published"
          value={offers.filter((o) => o.status !== "published").length}
        />
      </div>
      <Card title="Directory listing">
        <p className="muted" style={{ marginTop: 0 }}>
          Published offers are listed for buyers by default. Turn listing off to keep an offer
          site-only; agents can still pay it on your website.
        </p>
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {offers.map((o) => {
            const live = publicIds.has(o.id);
            return (
              <li key={o.id} style={rowStyle}>
                <div style={{ minWidth: 0 }}>
                  <b>{o.title}</b>{" "}
                  {live ? (
                    <Pill tone="ok">Live in directory</Pill>
                  ) : o.directoryListed === false ? (
                    <Pill tone="muted">Hidden</Pill>
                  ) : o.status !== "published" ? (
                    <Pill tone="warn">Lists when published</Pill>
                  ) : (
                    <Pill tone="muted">Past sunset</Pill>
                  )}
                  <div className="muted" style={{ fontSize: 12.5 }}>
                    {o.slug} · {o.version ?? "v1"} · {o.priceUsdc} USDC · {o.status}
                  </div>
                </div>
                <Toggle
                  label="List in directory"
                  checked={o.directoryListed !== false}
                  disabled={busyId === o.id}
                  onChange={(next) => void setListed(o, next)}
                />
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- analytics

type AnalyticsOffer = {
  offerId: string;
  slug: string;
  version: string;
  calls: { paid: number; sandbox: number; denied: number };
  revenueUsdc: string;
  uniqueBuyers: number;
  uniqueAgents: number;
  topBuyers: { id: string; calls: number }[];
  topAgents: { id: string; calls: number }[];
  daily: { day: string; calls: number; revenueUsdc: string }[];
};

type Analytics = {
  windowDays: number;
  totals: { paidCalls: number; revenueUsdc: string; uniqueBuyers: number };
  offers: AnalyticsOffer[];
};

function DailyBars({ daily }: { daily: AnalyticsOffer["daily"] }) {
  if (daily.length === 0) return null;
  const max = Math.max(...daily.map((d) => d.calls), 1);
  return (
    <div
      style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 48, marginTop: 10 }}
      aria-label="Calls per day"
    >
      {daily.map((d) => (
        <div
          key={d.day}
          title={`${d.day}: ${d.calls} calls · ${d.revenueUsdc} USDC`}
          style={{
            flex: "1 1 0",
            maxWidth: 18,
            height: `${Math.max(6, (d.calls / max) * 100)}%`,
            background: "var(--color-accent, #4f46e5)",
            borderRadius: 3,
            opacity: 0.85,
          }}
        />
      ))}
    </div>
  );
}

export function AnalyticsView() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/v1/seller/analytics?days=${days}`);
      if (!res.ok) {
        toast(await sellerApiError(res, "Could not load analytics"), "err");
        return;
      }
      setData((await res.json()) as Analytics);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 900 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <label className="field" style={{ margin: 0 }}>
          <span>Window</span>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={1}>Last 24 hours</option>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        </label>
        <Button variant="secondary" size="sm" disabled={loading} onClick={() => void load()}>
          {loading ? "Loading…" : "Refresh"}
        </Button>
      </div>
      <div
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
        }}
      >
        <Stat label="Paid calls" value={data?.totals.paidCalls ?? "—"} />
        <Stat label="Revenue" value={data ? `${data.totals.revenueUsdc} USDC` : "—"} />
        <Stat label="Unique buyers" value={data?.totals.uniqueBuyers ?? "—"} />
      </div>
      {data && data.offers.length === 0 && (
        <Card>
          <Empty>No offers yet.</Empty>
        </Card>
      )}
      {data?.offers.map((o) => (
        <Card
          key={o.offerId}
          title={`${o.slug} · ${o.version}`}
          actions={<b>{o.revenueUsdc} USDC</b>}
        >
          <div className="muted" style={{ fontSize: 13 }}>
            {o.calls.paid} paid · {o.calls.sandbox} sandbox · {o.calls.denied} denied ·{" "}
            {o.uniqueBuyers} buyers · {o.uniqueAgents} agents
          </div>
          <DailyBars daily={o.daily} />
          {(o.topBuyers.length > 0 || o.topAgents.length > 0) && (
            <div
              style={{
                display: "grid",
                gap: 12,
                gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))",
                marginTop: 12,
              }}
            >
              <div>
                <span className="muted" style={{ fontSize: 12 }}>
                  Top buyers
                </span>
                <ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 13 }}>
                  {o.topBuyers.map((b) => (
                    <li key={b.id}>
                      <code>{b.id}</code> · {b.calls}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <span className="muted" style={{ fontSize: 12 }}>
                  Top agents
                </span>
                <ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 13 }}>
                  {o.topAgents.map((a) => (
                    <li key={a.id}>
                      <code>{a.id}</code> · {a.calls}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- invoices + payouts

type Invoice = {
  id: string;
  periodStart: string;
  periodEnd: string;
  totalUsdc: string;
  settlementCount: number;
  payoutAddress?: string;
  status: string;
  createdAt: string;
};

type Payouts = {
  payoutAddress: string | null;
  network: string | null;
  settledUsdc: string;
  settlementCount: number;
  lastTxHash: string | null;
  note: string;
};

function monthInputValue(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function BillingView() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payouts, setPayouts] = useState<Payouts | null>(null);
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return monthInputValue(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));
  });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [inv, pay] = await Promise.all([
      apiFetch("/v1/seller/invoices"),
      apiFetch("/v1/seller/payouts"),
    ]);
    if (inv.ok) setInvoices(((await inv.json()) as { invoices: Invoice[] }).invoices);
    if (pay.ok) setPayouts((await pay.json()) as Payouts);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function generate() {
    const [y, m] = month.split("-").map(Number);
    if (!y || !m) return;
    setBusy(true);
    try {
      const res = await apiFetch("/v1/seller/invoices/generate", {
        method: "POST",
        body: JSON.stringify({
          periodStart: new Date(Date.UTC(y, m - 1, 1)).toISOString(),
          periodEnd: new Date(Date.UTC(y, m, 1)).toISOString(),
        }),
      });
      if (!res.ok) {
        toast(await sellerApiError(res, "Could not generate invoice"), "err");
        return;
      }
      const body = (await res.json()) as { created: boolean };
      toast(
        body.created ? "Invoice issued" : "Invoice for that month already exists",
        body.created ? "ok" : "info",
      );
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 860 }}>
      <div
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
        }}
      >
        <Stat label="Settled to wallet" value={payouts ? `${payouts.settledUsdc} USDC` : "—"} />
        <Stat label="Settlements" value={payouts?.settlementCount ?? "—"} />
        <Stat label="Invoices" value={invoices.length} />
      </div>
      <Card title="Payout wallet">
        {payouts?.payoutAddress ? (
          <>
            <code style={{ wordBreak: "break-all" }}>{payouts.payoutAddress}</code>
            <span className="muted"> · {payouts.network}</span>
          </>
        ) : (
          <Empty>No payout address yet. Set one in Settings before publishing.</Empty>
        )}
        {payouts?.lastTxHash && (
          <p className="muted" style={{ fontSize: 12, marginBottom: 0, wordBreak: "break-all" }}>
            Last settlement tx {payouts.lastTxHash}
          </p>
        )}
        {payouts && (
          <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>
            {payouts.note}
          </p>
        )}
      </Card>
      <Card title="Generate invoice">
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <label className="field" style={{ margin: 0 }}>
            <span>Month (UTC)</span>
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </label>
          <Button disabled={busy} onClick={() => void generate()}>
            {busy ? "Generating…" : "Generate"}
          </Button>
        </div>
        <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>
          One invoice per month. Generating the same month again returns the existing invoice.
        </p>
      </Card>
      <Card title="Invoices">
        {invoices.length === 0 ? (
          <Empty>No invoices yet.</Empty>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {invoices.map((i) => (
              <li key={i.id} style={rowStyle}>
                <div>
                  <b>{i.periodStart.slice(0, 7)}</b> <Pill tone="ok">{i.status}</Pill>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {i.settlementCount} settlements · issued {fmtDate(i.createdAt)}
                  </div>
                </div>
                <b>{i.totalUsdc} USDC</b>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- access policies

type Policy = {
  id: string;
  offerId: string | null;
  buyerOrgId: string | null;
  agentId: string | null;
  effect: "allow" | "deny";
  ratePerMinute: number | null;
  ratePerDay: number | null;
  note: string;
  createdAt: string;
};

const emptyPolicy = {
  offerId: "",
  buyerOrgId: "",
  agentId: "",
  effect: "allow" as "allow" | "deny",
  ratePerMinute: "",
  ratePerDay: "",
  note: "",
};

export function PoliciesView({ offers }: { offers: SellerOffer[] }) {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [form, setForm] = useState(emptyPolicy);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await apiFetch("/v1/seller/policies");
    if (res.ok) setPolicies(((await res.json()) as { policies: Policy[] }).policies);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    setBusy(true);
    try {
      const body: Record<string, unknown> = { effect: form.effect, note: form.note };
      if (form.offerId) body.offerId = form.offerId;
      if (form.buyerOrgId.trim()) body.buyerOrgId = form.buyerOrgId.trim();
      if (form.agentId.trim()) body.agentId = form.agentId.trim();
      if (form.effect === "allow") {
        if (form.ratePerMinute) body.ratePerMinute = Number(form.ratePerMinute);
        if (form.ratePerDay) body.ratePerDay = Number(form.ratePerDay);
      }
      const res = await apiFetch("/v1/seller/policies", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        toast(await sellerApiError(res, "Could not save policy"), "err");
        return;
      }
      toast("Policy saved", "ok");
      setForm(emptyPolicy);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    const res = await apiFetch(`/v1/seller/policies/${id}`, { method: "DELETE" });
    if (!res.ok) {
      toast(await sellerApiError(res, "Could not delete policy"), "err");
      return;
    }
    toast("Policy removed", "ok");
    await load();
  }

  const offerLabel = (id: string | null) =>
    id ? (offers.find((o) => o.id === id)?.slug ?? id) : "All offers";

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 860 }}>
      <Card title="New policy">
        <div style={formGrid}>
          <label className="field">
            <span>Offer</span>
            <select
              value={form.offerId}
              onChange={(e) => setForm({ ...form, offerId: e.target.value })}
            >
              <option value="">All offers</option>
              {offers.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.slug}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Effect</span>
            <select
              value={form.effect}
              onChange={(e) => setForm({ ...form, effect: e.target.value as "allow" | "deny" })}
            >
              <option value="allow">Allow with rate limit</option>
              <option value="deny">Deny</option>
            </select>
          </label>
          <label className="field">
            <span>Buyer org (optional)</span>
            <input
              value={form.buyerOrgId}
              onChange={(e) => setForm({ ...form, buyerOrgId: e.target.value })}
              placeholder="org_…  (blank = any buyer)"
              spellCheck={false}
            />
          </label>
          <label className="field">
            <span>Agent (optional)</span>
            <input
              value={form.agentId}
              onChange={(e) => setForm({ ...form, agentId: e.target.value })}
              placeholder="agt_…  (blank = any agent)"
              spellCheck={false}
            />
          </label>
          {form.effect === "allow" && (
            <>
              <label className="field">
                <span>Calls per minute</span>
                <input
                  type="number"
                  min={1}
                  value={form.ratePerMinute}
                  onChange={(e) => setForm({ ...form, ratePerMinute: e.target.value })}
                />
              </label>
              <label className="field">
                <span>Calls per day</span>
                <input
                  type="number"
                  min={1}
                  value={form.ratePerDay}
                  onChange={(e) => setForm({ ...form, ratePerDay: e.target.value })}
                />
              </label>
            </>
          )}
          <label className="field" style={{ gridColumn: "1 / -1" }}>
            <span>Note</span>
            <input
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              placeholder="Shown to the buyer when blocked"
            />
          </label>
        </div>
        <Button style={{ marginTop: 12 }} disabled={busy} onClick={() => void create()}>
          Save policy
        </Button>
      </Card>
      <Card title="Active policies">
        {policies.length === 0 ? (
          <Empty>No policies. Every buyer and agent can call your offers without limits.</Empty>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {policies.map((p) => (
              <li key={p.id} style={rowStyle}>
                <div style={{ minWidth: 0 }}>
                  <Pill tone={p.effect === "deny" ? "danger" : "ok"}>{p.effect}</Pill>{" "}
                  <b>{offerLabel(p.offerId)}</b>
                  <div className="muted" style={{ fontSize: 12.5 }}>
                    Buyer {p.buyerOrgId ?? "any"} · Agent {p.agentId ?? "any"}
                    {p.ratePerMinute ? ` · ${p.ratePerMinute}/min` : ""}
                    {p.ratePerDay ? ` · ${p.ratePerDay}/day` : ""}
                  </div>
                  {p.note && (
                    <div className="muted" style={{ fontSize: 12 }}>
                      {p.note}
                    </div>
                  )}
                </div>
                <Button variant="secondary" size="sm" onClick={() => void remove(p.id)}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
        <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>
          Policies apply to sandbox calls today. Enforcement on live buyer payments is coming next.
        </p>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- versions

function defaultSunset(): string {
  const d = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

export function VersionsView({ offers, onOffersChanged }: FeatureProps) {
  const [offerId, setOfferId] = useState<string>(offers[0]?.id ?? "");
  const [newSlug, setNewSlug] = useState("");
  const [newEndpoint, setNewEndpoint] = useState("");
  const [sunset, setSunset] = useState(defaultSunset);
  const [successor, setSuccessor] = useState("");
  const [busy, setBusy] = useState(false);

  const offer = offers.find((o) => o.id === offerId) ?? offers[0];

  useEffect(() => {
    if (!offer) return;
    setNewSlug(
      `${offer.slug.replace(/-v\d+$/, "")}-v${Number((offer.version ?? "v1").slice(1)) + 1}`,
    );
    setNewEndpoint(offer.endpointUrl);
    setSuccessor(offer.successorOfferId ?? "");
  }, [offer?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!offer) return <NoOffers />;

  async function createVersion() {
    setBusy(true);
    try {
      const res = await apiFetch(`/v1/seller/offers/${offer.id}/versions`, {
        method: "POST",
        body: JSON.stringify({ slug: newSlug, endpointUrl: newEndpoint || undefined }),
      });
      if (!res.ok) {
        toast(await sellerApiError(res, "Could not create version"), "err");
        return;
      }
      const body = (await res.json()) as { offer: { id: string; version: string } };
      toast(
        `Created ${body.offer.version} as a draft — verify and publish it in Integrations`,
        "ok",
      );
      setSuccessor(body.offer.id);
      await onOffersChanged();
    } finally {
      setBusy(false);
    }
  }

  async function deprecate() {
    setBusy(true);
    try {
      const res = await apiFetch(`/v1/seller/offers/${offer.id}/deprecate`, {
        method: "POST",
        body: JSON.stringify({
          sunsetAt: new Date(`${sunset}T00:00:00Z`).toISOString(),
          successorOfferId: successor || undefined,
        }),
      });
      if (!res.ok) {
        toast(await sellerApiError(res, "Could not deprecate"), "err");
        return;
      }
      toast("Deprecation scheduled; buyers and webhooks are notified", "ok");
      await onOffersChanged();
    } finally {
      setBusy(false);
    }
  }

  const minSunset = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 860 }}>
      <Card title="Versions">
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {offers.map((o) => (
            <li key={o.id} style={rowStyle}>
              <div>
                <b>{o.slug}</b> <Pill tone="muted">{o.version ?? "v1"}</Pill>{" "}
                {o.deprecatedAt ? (
                  <Pill tone="warn">Sunsets {o.sunsetAt?.slice(0, 10)}</Pill>
                ) : (
                  <Pill tone="ok">{o.status}</Pill>
                )}
                {o.successorOfferId && (
                  <div className="muted" style={{ fontSize: 12 }}>
                    Successor:{" "}
                    {offers.find((s) => s.id === o.successorOfferId)?.slug ?? o.successorOfferId}
                  </div>
                )}
              </div>
              <Button
                variant={o.id === offer.id ? "default" : "secondary"}
                size="sm"
                onClick={() => setOfferId(o.id)}
              >
                {o.id === offer.id ? "Selected" : "Select"}
              </Button>
            </li>
          ))}
        </ul>
      </Card>
      <Card title={`New version of ${offer.slug}`}>
        <div style={formGrid}>
          <label className="field">
            <span>New slug</span>
            <input value={newSlug} onChange={(e) => setNewSlug(e.target.value.toLowerCase())} />
          </label>
          <label className="field">
            <span>Endpoint URL</span>
            <input value={newEndpoint} onChange={(e) => setNewEndpoint(e.target.value)} />
          </label>
        </div>
        <Button
          style={{ marginTop: 12 }}
          disabled={busy || !newSlug}
          onClick={() => void createVersion()}
        >
          Create version
        </Button>
        <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>
          The copy keeps price, network, and directory settings, and starts as a draft.
        </p>
      </Card>
      <Card title={`Deprecate ${offer.slug}`}>
        <div style={formGrid}>
          <label className="field">
            <span>Sunset date (UTC)</span>
            <input
              type="date"
              min={minSunset}
              value={sunset}
              onChange={(e) => setSunset(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Successor (optional)</span>
            <select value={successor} onChange={(e) => setSuccessor(e.target.value)}>
              <option value="">None</option>
              {offers
                .filter((o) => o.id !== offer.id)
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.slug} ({o.version ?? "v1"})
                  </option>
                ))}
            </select>
          </label>
        </div>
        <Button
          variant="secondary"
          style={{ marginTop: 12 }}
          disabled={busy}
          onClick={() => void deprecate()}
        >
          {offer.deprecatedAt ? "Update deprecation" : "Schedule deprecation"}
        </Button>
        <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>
          Buyers get at least 7 days of notice. The offer stays listed and payable until the sunset
          date.
        </p>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- sandbox

export function SandboxView({ offers, onOffersChanged }: FeatureProps) {
  const [offerId, setOfferId] = useState<string>(offers[0]?.id ?? "");
  const [buyerOrgId, setBuyerOrgId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [result, setResult] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const offer = offers.find((o) => o.id === offerId) ?? offers[0];

  if (!offer) return <NoOffers />;

  async function toggleSandbox(next: boolean) {
    setBusy(true);
    try {
      if (await patchOffer(offer.id, { sandboxEnabled: next })) {
        toast(next ? "Sandbox on" : "Sandbox off", "ok");
        await onOffersChanged();
      }
    } finally {
      setBusy(false);
    }
  }

  async function tryIt() {
    setBusy(true);
    try {
      const res = await apiFetch(`/v1/sandbox/offers/${offer.id}/try`, {
        method: "POST",
        body: JSON.stringify({
          ...(buyerOrgId.trim() ? { buyerOrgId: buyerOrgId.trim() } : {}),
          ...(agentId.trim() ? { agentId: agentId.trim() } : {}),
        }),
      });
      const body = (await res.json().catch(() => null)) as unknown;
      setResult({ httpStatus: res.status, ...(body as object) });
    } finally {
      setBusy(false);
    }
  }

  const sandboxUrl = `/v1/sandbox/offers/${offer.id}/try`;
  const tryable = offer.status === "published" || offer.status === "verified";

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 860 }}>
      <Card title="Buyer sandbox">
        <p className="muted" style={{ marginTop: 0 }}>
          Buyers can wire their agent against a simulated payment request and unlock before paying.
          No USDC moves.
        </p>
        <div style={formGrid}>
          <label className="field">
            <span>Offer</span>
            <select value={offer.id} onChange={(e) => setOfferId(e.target.value)}>
              {offers.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.slug} ({o.status})
                </option>
              ))}
            </select>
          </label>
          <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: 8 }}>
            <Toggle
              label="Sandbox enabled"
              checked={offer.sandboxEnabled !== false}
              disabled={busy}
              onChange={(next) => void toggleSandbox(next)}
            />
          </div>
        </div>
        <p className="muted" style={{ fontSize: 12.5 }}>
          Public endpoint: <code>POST {sandboxUrl}</code>
        </p>
      </Card>
      <Card title="Try it as a buyer">
        <div style={formGrid}>
          <label className="field">
            <span>Buyer org (optional)</span>
            <input
              value={buyerOrgId}
              onChange={(e) => setBuyerOrgId(e.target.value)}
              spellCheck={false}
            />
          </label>
          <label className="field">
            <span>Agent (optional)</span>
            <input
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              spellCheck={false}
            />
          </label>
        </div>
        <Button style={{ marginTop: 12 }} disabled={busy || !tryable} onClick={() => void tryIt()}>
          Run sandbox call
        </Button>
        {!tryable && (
          <p className="muted" style={{ fontSize: 12.5 }}>
            Verify the offer first; drafts are not available in the sandbox.
          </p>
        )}
        {result !== null && (
          <pre style={{ ...preStyle, marginTop: 12 }}>{JSON.stringify(result, null, 2)}</pre>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- webhooks + alerts

type Webhook = { id: string; url: string; createdAt: string };
type Alert = { id: string; offerId?: string; thresholdCalls: number; lastFiredDay?: string };

export function WebhooksView({ offers }: { offers: SellerOffer[] }) {
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [events, setEvents] = useState<string[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [alertOffer, setAlertOffer] = useState("");
  const [threshold, setThreshold] = useState("100");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [w, a] = await Promise.all([
      apiFetch("/v1/seller/webhooks"),
      apiFetch("/v1/seller/alerts"),
    ]);
    if (w.ok) {
      const body = (await w.json()) as { webhooks: Webhook[]; events: string[] };
      setWebhooks(body.webhooks);
      setEvents(body.events);
    }
    if (a.ok) setAlerts(((await a.json()) as { alerts: Alert[] }).alerts);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function addWebhook() {
    setBusy(true);
    try {
      const res = await apiFetch("/v1/seller/webhooks", {
        method: "POST",
        body: JSON.stringify({ url }),
      });
      if (!res.ok) {
        toast(await sellerApiError(res, "Could not add webhook"), "err");
        return;
      }
      const body = (await res.json()) as { secret: string };
      setSecret(body.secret);
      setUrl("");
      toast("Webhook added — copy the signing secret now", "ok");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function removeWebhook(id: string) {
    const res = await apiFetch(`/v1/seller/webhooks/${id}`, { method: "DELETE" });
    if (!res.ok) {
      toast(await sellerApiError(res, "Could not remove webhook"), "err");
      return;
    }
    await load();
  }

  async function addAlert() {
    setBusy(true);
    try {
      const res = await apiFetch("/v1/seller/alerts", {
        method: "POST",
        body: JSON.stringify({
          thresholdCalls: Number(threshold),
          ...(alertOffer ? { offerId: alertOffer } : {}),
        }),
      });
      if (!res.ok) {
        toast(await sellerApiError(res, "Could not add alert"), "err");
        return;
      }
      toast("Usage alert added", "ok");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function removeAlert(id: string) {
    const res = await apiFetch(`/v1/seller/alerts/${id}`, { method: "DELETE" });
    if (res.ok) await load();
  }

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 860 }}>
      <Card title="Webhook endpoints">
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <label className="field" style={{ flex: "1 1 320px", margin: 0 }}>
            <span>HTTPS URL</span>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://api.yoursite.com/abi-webhooks"
              spellCheck={false}
            />
          </label>
          <Button disabled={busy || !url} onClick={() => void addWebhook()}>
            Add endpoint
          </Button>
        </div>
        {secret && (
          <div style={{ marginTop: 12 }}>
            <p className="muted" style={{ fontSize: 12.5, margin: "0 0 6px" }}>
              Signing secret (shown once). Verify <code>x-policyvault-signature</code> with it.
            </p>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <code style={{ wordBreak: "break-all" }}>{secret}</code>
              <Button
                variant="secondary"
                size="sm"
                onClick={async () => {
                  await navigator.clipboard.writeText(secret);
                  toast("Secret copied", "ok");
                }}
              >
                Copy
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setSecret(null)}>
                Done
              </Button>
            </div>
          </div>
        )}
        {webhooks.length === 0 ? (
          <div style={{ marginTop: 12 }}>
            <Empty>No endpoints yet.</Empty>
          </div>
        ) : (
          <ul style={{ listStyle: "none", margin: "12px 0 0", padding: 0 }}>
            {webhooks.map((w) => (
              <li key={w.id} style={rowStyle}>
                <div style={{ minWidth: 0 }}>
                  <code style={{ wordBreak: "break-all" }}>{w.url}</code>
                  <div className="muted" style={{ fontSize: 12 }}>
                    Added {fmtDate(w.createdAt)}
                  </div>
                </div>
                <Button variant="secondary" size="sm" onClick={() => void removeWebhook(w.id)}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
        {events.length > 0 && (
          <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>
            Events: {events.join(", ")}
          </p>
        )}
      </Card>
      <Card title="Usage threshold alerts">
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Sends <code>seller.usage.threshold</code> once per UTC day when paid calls reach the
          threshold.
        </p>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <label className="field" style={{ margin: 0 }}>
            <span>Offer</span>
            <select value={alertOffer} onChange={(e) => setAlertOffer(e.target.value)}>
              <option value="">All offers</option>
              {offers.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.slug}
                </option>
              ))}
            </select>
          </label>
          <label className="field" style={{ margin: 0 }}>
            <span>Calls per day</span>
            <input
              type="number"
              min={1}
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
            />
          </label>
          <Button disabled={busy || !Number(threshold)} onClick={() => void addAlert()}>
            Add alert
          </Button>
        </div>
        {alerts.length > 0 && (
          <ul style={{ listStyle: "none", margin: "12px 0 0", padding: 0 }}>
            {alerts.map((a) => (
              <li key={a.id} style={rowStyle}>
                <div>
                  <b>{a.thresholdCalls} calls/day</b> ·{" "}
                  {a.offerId
                    ? (offers.find((o) => o.id === a.offerId)?.slug ?? a.offerId)
                    : "All offers"}
                  <div className="muted" style={{ fontSize: 12 }}>
                    Last fired {a.lastFiredDay ?? "never"}
                  </div>
                </div>
                <Button variant="secondary" size="sm" onClick={() => void removeAlert(a.id)}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
