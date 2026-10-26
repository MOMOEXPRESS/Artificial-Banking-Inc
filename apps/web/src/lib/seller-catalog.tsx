"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { sellerApiError, sellerApiFetch as apiFetch } from "./seller-api";
import {
  Card,
  Empty,
  Pill,
  fmtDate,
  formGrid,
  patchOffer,
  preStyle,
  rowStyle,
  type SellerOffer,
} from "./seller-features";
import { toast } from "./toast";

export const OFFER_CATEGORIES = [
  "data",
  "research",
  "ai-model",
  "media",
  "finance",
  "developer-tools",
  "other",
] as const;

export type SellerActivityRow = {
  id: string;
  offerId: string | null;
  offerTitle?: string | null;
  buyerOrgId?: string | null;
  buyerName?: string | null;
  amountUsdc: string;
  txHash: string | null;
  explorerUrl?: string | null;
  state: string;
  createdAt: string;
};

type ChallengeCheck = {
  httpStatus: number;
  expectedPayTo: string | null;
  expectedNetwork: string;
  expectedPriceUsdc: string;
  offered?: { scheme: string; network: string; asset: string; amount: string; payTo: string }[];
  problems: string[];
};

/** Older saved checks have no `problems` (or `offered`) list; treat those as empty. */
export function toChallengeCheck(raw: unknown): ChallengeCheck | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const check = raw as Partial<ChallengeCheck>;
  return {
    ...(check as ChallengeCheck),
    problems: Array.isArray(check.problems) ? check.problems : [],
    offered: Array.isArray(check.offered) ? check.offered : undefined,
  };
}

export function statusTone(status: SellerOffer["status"]): "ok" | "warn" | "muted" | "danger" {
  if (status === "published") return "ok";
  if (status === "verified") return "warn";
  if (status === "paused") return "danger";
  return "muted";
}

const emptyForm = {
  slug: "",
  title: "",
  hosted: true,
  endpointUrl: "",
  hostedContent: "",
  description: "",
  category: "data" as string,
  priceUsdc: "0.10",
  network: "base-sepolia",
};

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

// ---------------------------------------------------------------- catalog

export function CatalogView({
  offers,
  defaultNetwork,
  onOffersChanged,
  onIntegrate,
}: {
  offers: SellerOffer[];
  defaultNetwork: string;
  onOffersChanged: () => Promise<void> | void;
  onIntegrate: (offerId: string) => void;
}) {
  const [form, setForm] = useState({ ...emptyForm, network: defaultNetwork || "base-sepolia" });
  const [slugTouched, setSlugTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [archived, setArchived] = useState<SellerOffer[]>([]);

  useEffect(() => {
    if (!showArchived) return;
    void (async () => {
      const res = await apiFetch("/v1/seller/offers?archived=1").catch(() => null);
      if (!res?.ok) return;
      const body = (await res.json()) as { offers: SellerOffer[] };
      setArchived(body.offers.filter((o) => o.archivedAt));
    })();
  }, [showArchived, offers]);

  async function create() {
    setBusy(true);
    try {
      const res = await apiFetch("/v1/seller/offers", {
        method: "POST",
        body: JSON.stringify({
          slug: form.slug,
          title: form.title,
          hosted: form.hosted,
          endpointUrl: form.hosted ? undefined : form.endpointUrl,
          hostedContent: form.hosted ? form.hostedContent : "",
          description: form.description,
          category: form.category,
          priceUsdc: form.priceUsdc,
          network: form.network,
        }),
      });
      if (!res.ok) {
        toast(await sellerApiError(res, "Could not create offer"), "err");
        return;
      }
      const body = (await res.json()) as { offer: SellerOffer };
      toast("Offer created as a draft. Verify it, then publish.", "ok");
      setForm({ ...emptyForm, network: form.network });
      setSlugTouched(false);
      await onOffersChanged();
      onIntegrate(body.offer.id);
    } finally {
      setBusy(false);
    }
  }

  async function pause(offer: SellerOffer) {
    if (await patchOffer(offer.id, { status: "paused" })) {
      toast("Paused. Buyers get 409 until you publish again.", "ok");
      await onOffersChanged();
    }
  }

  async function resume(offer: SellerOffer) {
    const res = await apiFetch(`/v1/seller/offers/${offer.id}/publish`, {
      method: "POST",
      body: "{}",
    });
    if (!res.ok) {
      toast(await sellerApiError(res, "Could not resume"), "err");
      return;
    }
    toast("Back on sale", "ok");
    await onOffersChanged();
  }

  async function archive(offer: SellerOffer) {
    if (
      !window.confirm(
        `Archive "${offer.title}"? It goes off sale and out of the directory. Past sales stay on your statements.`,
      )
    )
      return;
    const res = await apiFetch(`/v1/seller/offers/${offer.id}/archive`, {
      method: "POST",
      body: "{}",
    });
    if (!res.ok) {
      toast(await sellerApiError(res, "Could not archive"), "err");
      return;
    }
    toast("Archived", "ok");
    await onOffersChanged();
  }

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 880 }}>
      <Card title="New offer">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <Button
            size="sm"
            variant={form.hosted ? "default" : "secondary"}
            onClick={() => setForm({ ...form, hosted: true })}
          >
            ABI hosts it
          </Button>
          <Button
            size="sm"
            variant={form.hosted ? "secondary" : "default"}
            onClick={() => setForm({ ...form, hosted: false })}
          >
            My own server
          </Button>
        </div>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          {form.hosted
            ? "ABI serves the paid URL for you and returns your content once the buyer's USDC settles to your wallet. Nothing to deploy."
            : "Your server returns the x402 challenge. Integrations gives you working Express, Hono and Next.js code."}
        </p>
        <div style={formGrid}>
          <label className="field">
            <span>Title</span>
            <input
              value={form.title}
              onChange={(e) =>
                setForm({
                  ...form,
                  title: e.target.value,
                  slug: slugTouched ? form.slug : slugify(e.target.value),
                })
              }
              placeholder="Daily market report"
            />
          </label>
          <label className="field">
            <span>Slug</span>
            <input
              value={form.slug}
              onChange={(e) => {
                setSlugTouched(true);
                setForm({ ...form, slug: e.target.value.toLowerCase() });
              }}
              placeholder="daily-market-report"
            />
          </label>
          <label className="field">
            <span>Category</span>
            <select
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            >
              {OFFER_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Price per call (USDC)</span>
            <input
              value={form.priceUsdc}
              onChange={(e) => setForm({ ...form, priceUsdc: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Network</span>
            <select
              value={form.network}
              onChange={(e) => setForm({ ...form, network: e.target.value })}
            >
              <option value="base-sepolia">Base Sepolia (test USDC)</option>
              <option value="base">Base (real USDC)</option>
            </select>
          </label>
          <label className="field" style={{ gridColumn: "1 / -1" }}>
            <span>Description buyers see</span>
            <textarea
              rows={2}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="What the agent gets for each paid call."
            />
          </label>
          {form.hosted ? (
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <span>Content a paid call returns (text or JSON)</span>
              <textarea
                rows={5}
                value={form.hostedContent}
                onChange={(e) => setForm({ ...form, hostedContent: e.target.value })}
                placeholder='{"report": "..."}'
                spellCheck={false}
              />
            </label>
          ) : (
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <span>Endpoint URL on your server</span>
              <input
                value={form.endpointUrl}
                onChange={(e) => setForm({ ...form, endpointUrl: e.target.value })}
                placeholder="https://api.yoursite.com/report"
              />
            </label>
          )}
        </div>
        <Button style={{ marginTop: 12 }} disabled={busy} onClick={() => void create()}>
          {busy ? "Adding…" : "Add offer"}
        </Button>
      </Card>

      <Card
        title="Your catalog"
        actions={
          <Button size="sm" variant="secondary" onClick={() => setShowArchived((v) => !v)}>
            {showArchived ? "Hide archived" : "Show archived"}
          </Button>
        }
      >
        {offers.length === 0 ? (
          <Empty>No offers yet. Add one to start selling.</Empty>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {offers.map((o) => (
              <li key={o.id} style={{ ...rowStyle, display: "block" }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    flexWrap: "wrap",
                    alignItems: "center",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}
                    >
                      <b>{o.title}</b>
                      <Pill tone={statusTone(o.status)}>{o.status}</Pill>
                      {o.hosted && <Pill tone="muted">ABI hosted</Pill>}
                      {o.accessMode === "allowlist" && <Pill tone="muted">approved buyers</Pill>}
                      {o.deprecatedAt && <Pill tone="warn">deprecated</Pill>}
                    </div>
                    <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
                      {o.slug} · {o.version ?? "v1"} · {o.category ?? "other"} · {o.priceUsdc} USDC
                      on {o.network}
                    </div>
                    <div className="muted" style={{ fontSize: 12, wordBreak: "break-all" }}>
                      {o.endpointUrl}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <Button size="sm" variant="secondary" onClick={() => onIntegrate(o.id)}>
                      {o.status === "draft" ? "Verify & publish" : "Integration"}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setEditingId(editingId === o.id ? null : o.id)}
                    >
                      {editingId === o.id ? "Close" : "Edit"}
                    </Button>
                    {o.status === "published" && (
                      <Button size="sm" variant="secondary" onClick={() => void pause(o)}>
                        Pause
                      </Button>
                    )}
                    {o.status === "paused" && (
                      <Button size="sm" variant="secondary" onClick={() => void resume(o)}>
                        Resume
                      </Button>
                    )}
                    <Button size="sm" variant="secondary" onClick={() => void archive(o)}>
                      Archive
                    </Button>
                  </div>
                </div>
                {editingId === o.id && (
                  <OfferEditor
                    offer={o}
                    onSaved={async () => {
                      setEditingId(null);
                      await onOffersChanged();
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
        {showArchived && (
          <div style={{ marginTop: 16 }}>
            <h4 style={{ margin: "0 0 6px" }}>Archived</h4>
            {archived.length === 0 ? (
              <Empty>Nothing archived.</Empty>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {archived.map((o) => (
                  <li key={o.id} style={rowStyle}>
                    <span>
                      {o.title} <span className="muted">· {o.slug}</span>
                    </span>
                    <span className="muted" style={{ fontSize: 12 }}>
                      archived {fmtDate(o.archivedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

function OfferEditor({ offer, onSaved }: { offer: SellerOffer; onSaved: () => Promise<void> }) {
  const [draft, setDraft] = useState({
    title: offer.title,
    description: offer.description ?? "",
    category: offer.category ?? "other",
    priceUsdc: offer.priceUsdc,
    network: offer.network,
    endpointUrl: offer.endpointUrl,
    hostedContent: offer.hostedContent ?? "",
  });
  const [busy, setBusy] = useState(false);
  const termsChange =
    draft.priceUsdc !== offer.priceUsdc ||
    draft.network !== offer.network ||
    (!offer.hosted && draft.endpointUrl !== offer.endpointUrl);

  async function save() {
    setBusy(true);
    try {
      const patch: Record<string, unknown> = {
        title: draft.title,
        description: draft.description,
        category: draft.category,
      };
      if (draft.priceUsdc !== offer.priceUsdc) patch.priceUsdc = draft.priceUsdc;
      if (draft.network !== offer.network) patch.network = draft.network;
      if (!offer.hosted && draft.endpointUrl !== offer.endpointUrl)
        patch.endpointUrl = draft.endpointUrl;
      if (offer.hosted) patch.hostedContent = draft.hostedContent;
      if (await patchOffer(offer.id, patch)) {
        toast(
          termsChange ? "Saved. The offer is back in draft: verify and publish again." : "Saved",
          "ok",
        );
        await onSaved();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
      <div style={formGrid}>
        <label className="field">
          <span>Title</span>
          <input
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
        </label>
        <label className="field">
          <span>Category</span>
          <select
            value={draft.category}
            onChange={(e) => setDraft({ ...draft, category: e.target.value })}
          >
            {OFFER_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Price (USDC)</span>
          <input
            value={draft.priceUsdc}
            onChange={(e) => setDraft({ ...draft, priceUsdc: e.target.value })}
          />
        </label>
        <label className="field">
          <span>Network</span>
          <select
            value={draft.network}
            onChange={(e) => setDraft({ ...draft, network: e.target.value })}
          >
            <option value="base-sepolia">Base Sepolia</option>
            <option value="base">Base</option>
          </select>
        </label>
        <label className="field" style={{ gridColumn: "1 / -1" }}>
          <span>Description</span>
          <textarea
            rows={2}
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          />
        </label>
        {offer.hosted ? (
          <label className="field" style={{ gridColumn: "1 / -1" }}>
            <span>Paid content</span>
            <textarea
              rows={5}
              spellCheck={false}
              value={draft.hostedContent}
              onChange={(e) => setDraft({ ...draft, hostedContent: e.target.value })}
            />
          </label>
        ) : (
          <label className="field" style={{ gridColumn: "1 / -1" }}>
            <span>Endpoint URL</span>
            <input
              value={draft.endpointUrl}
              onChange={(e) => setDraft({ ...draft, endpointUrl: e.target.value })}
            />
          </label>
        )}
      </div>
      {termsChange && (
        <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
          Changing price, network or endpoint takes the offer off sale until you verify and publish
          it again, so no buyer pays terms they did not see.
        </p>
      )}
      <div>
        <Button size="sm" disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- integrations

type SnippetResponse = {
  hosted?: boolean;
  endpointUrl?: string;
  note?: string;
  snippets: Partial<Record<"express" | "hono" | "next", string>>;
};

export function IntegrationsView({
  offers,
  selectedOfferId,
  onSelect,
  onOffersChanged,
  hasPayoutAddress,
  onOpenSettings,
}: {
  offers: SellerOffer[];
  selectedOfferId: string | null;
  onSelect: (offerId: string) => void;
  onOffersChanged: () => Promise<void> | void;
  hasPayoutAddress: boolean;
  onOpenSettings: () => void;
}) {
  const offer = offers.find((o) => o.id === selectedOfferId) ?? offers[0] ?? null;
  const [snippet, setSnippet] = useState<SnippetResponse | null>(null);
  const [stack, setStack] = useState<"express" | "hono" | "next">("express");
  const [busy, setBusy] = useState<"verify" | "publish" | null>(null);
  const [check, setCheck] = useState<ChallengeCheck | null>(null);

  useEffect(() => {
    setSnippet(null);
    setCheck(toChallengeCheck(offer?.integration.lastChallenge));
    if (!offer) return;
    void (async () => {
      const res = await apiFetch(`/v1/seller/offers/${offer.id}/snippet`).catch(() => null);
      if (res?.ok) setSnippet((await res.json()) as SnippetResponse);
    })();
  }, [offer?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!offer) {
    return (
      <Card>
        <Empty>Create an offer in Catalog first.</Empty>
      </Card>
    );
  }

  async function verify() {
    if (!offer) return;
    setBusy("verify");
    try {
      const res = await apiFetch(`/v1/seller/offers/${offer.id}/verify`, {
        method: "POST",
        body: "{}",
      });
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean;
        challenge?: unknown;
        error?: { message?: string };
      } | null;
      if (body?.challenge) setCheck(toChallengeCheck(body.challenge));
      if (!res.ok || body?.ok === false) {
        toast(body?.error?.message ?? "Verify failed", "err");
      } else {
        toast("402 challenge matches your payee, network and price", "ok");
      }
      await onOffersChanged();
    } finally {
      setBusy(null);
    }
  }

  async function publish() {
    if (!offer) return;
    setBusy("publish");
    try {
      const res = await apiFetch(`/v1/seller/offers/${offer.id}/publish`, {
        method: "POST",
        body: "{}",
      });
      if (!res.ok) {
        toast(await sellerApiError(res, "Publish failed"), "err");
        return;
      }
      toast("Published. Buyer agents can pay it now.", "ok");
      await onOffersChanged();
    } finally {
      setBusy(null);
    }
  }

  const code = snippet?.snippets[stack];
  const canPublish =
    Boolean(offer.integration.lastVerifiedAt) &&
    (offer.status === "verified" || offer.status === "paused") &&
    hasPayoutAddress;

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 900 }}>
      <Card>
        <label className="field">
          <span>Offer</span>
          <select value={offer.id} onChange={(e) => onSelect(e.target.value)}>
            {offers.map((o) => (
              <option key={o.id} value={o.id}>
                {o.title} ({o.status})
              </option>
            ))}
          </select>
        </label>
        <ol className="muted" style={{ margin: "14px 0 0", paddingLeft: 18, lineHeight: 1.7 }}>
          <li>
            Payout wallet{" "}
            {hasPayoutAddress ? (
              <Pill tone="ok">set</Pill>
            ) : (
              <>
                <Pill tone="danger">missing</Pill>{" "}
                <Button size="sm" variant="secondary" onClick={onOpenSettings}>
                  Set it in Settings
                </Button>
              </>
            )}
          </li>
          <li>
            {offer.hosted
              ? "ABI serves the paid URL. Nothing to deploy."
              : "Deploy the snippet on your server."}
          </li>
          <li>
            Verify the unpaid GET returns a matching 402{" "}
            {offer.integration.lastVerifiedAt ? (
              <Pill tone="ok">verified {fmtDate(offer.integration.lastVerifiedAt)}</Pill>
            ) : (
              <Pill tone="muted">not verified</Pill>
            )}
          </li>
          <li>
            Publish <Pill tone={statusTone(offer.status)}>{offer.status}</Pill>
          </li>
        </ol>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
          <Button disabled={busy !== null} onClick={() => void verify()}>
            {busy === "verify" ? "Checking…" : "Verify unpaid 402"}
          </Button>
          <Button
            variant="secondary"
            disabled={busy !== null || !canPublish}
            onClick={() => void publish()}
          >
            {busy === "publish"
              ? "Publishing…"
              : offer.status === "paused"
                ? "Resume sales"
                : "Publish"}
          </Button>
        </div>
        {offer.integration.error && (
          <p style={{ color: "var(--color-danger)", marginTop: 12, marginBottom: 0 }}>
            {offer.integration.error}
          </p>
        )}
      </Card>

      {check && (
        <Card title="Last challenge check">
          <div style={formGrid}>
            <div>
              <span className="muted">HTTP status</span>
              <div>
                <b>{check.httpStatus}</b>
              </div>
            </div>
            <div>
              <span className="muted">Expected payee</span>
              <div style={{ fontSize: 12.5, wordBreak: "break-all" }}>
                {check.expectedPayTo ?? "—"}
              </div>
            </div>
            <div>
              <span className="muted">Expected price</span>
              <div>
                {check.expectedPriceUsdc} USDC on {check.expectedNetwork}
              </div>
            </div>
          </div>
          {check.offered && check.offered.length > 0 && (
            <pre style={{ ...preStyle, marginTop: 12 }}>
              {JSON.stringify(check.offered, null, 2)}
            </pre>
          )}
          {check.problems.length > 0 ? (
            <ul style={{ color: "var(--color-danger)", marginBottom: 0 }}>
              {check.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : (
            <p className="muted" style={{ marginBottom: 0 }}>
              No problems found.
            </p>
          )}
        </Card>
      )}

      {offer.hosted ? (
        <Card title="Hosted by ABI">
          <p className="muted" style={{ marginTop: 0 }}>
            {snippet?.note ?? "ABI serves this offer."} Buyers pay this URL:
          </p>
          <pre style={preStyle}>{offer.endpointUrl}</pre>
        </Card>
      ) : (
        <Card
          title="Server code (x402 v2)"
          actions={
            <div style={{ display: "flex", gap: 6 }}>
              {(["express", "hono", "next"] as const).map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={stack === s ? "default" : "secondary"}
                  onClick={() => setStack(s)}
                >
                  {s === "next" ? "Next.js" : s === "hono" ? "Hono" : "Express"}
                </Button>
              ))}
            </div>
          }
        >
          {code ? (
            <>
              <pre style={preStyle}>{code}</pre>
              <Button
                size="sm"
                variant="secondary"
                style={{ marginTop: 10 }}
                onClick={async () => {
                  await navigator.clipboard.writeText(code);
                  toast("Copied", "ok");
                }}
              >
                Copy
              </Button>
            </>
          ) : (
            <Empty>Loading…</Empty>
          )}
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- activity

export function ActivityView({ rows }: { rows: SellerActivityRow[] }) {
  return (
    <Card title="Inbound payments">
      {rows.length === 0 ? (
        <Empty>
          No sales yet. When a buyer agent pays one of your offers, the settlement lands here with
          its on-chain transaction.
        </Empty>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {rows.map((row) => (
            <li key={row.id} style={rowStyle}>
              <div style={{ minWidth: 0 }}>
                <b>{row.amountUsdc} USDC</b>{" "}
                <span className="muted">
                  · {row.offerTitle ?? "offer"} · from {row.buyerName ?? "unknown buyer"}
                </span>
                <div className="muted" style={{ fontSize: 12, wordBreak: "break-all" }}>
                  {fmtDate(row.createdAt)} ·{" "}
                  {row.explorerUrl ? (
                    <a href={row.explorerUrl} target="_blank" rel="noreferrer">
                      {row.txHash?.slice(0, 10)}…{row.txHash?.slice(-6)}
                    </a>
                  ) : (
                    (row.txHash ?? "no transaction")
                  )}
                </div>
              </div>
              <Pill tone={row.state === "settled" ? "ok" : "muted"}>{row.state}</Pill>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
