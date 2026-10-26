"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Sidebar, SidebarFolder, SidebarItem } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ABAppIcon } from "./brand";
import { sellerApiFetch as apiFetch } from "./seller-api";
import {
  AnalyticsView,
  BillingView,
  DirectoryView,
  PoliciesView,
  SandboxView,
  VersionsView,
  WebhooksView,
  type SellerOffer,
} from "./seller-features";
import { toast } from "./toast";
import { Icon } from "./ui";
import { useTheme } from "./theme-provider";

export type SellerView =
  | "overview"
  | "catalog"
  | "integrations"
  | "activity"
  | "developers"
  | "settings"
  | "directory"
  | "versions"
  | "sandbox"
  | "analytics"
  | "billing"
  | "policies"
  | "webhooks";

type SellerOrg = { id: string; name: string; kind: "buyer" | "seller"; status: string };

type Partner = { id: string; email: string; name: string };

type SellerProfile = {
  displayName: string;
  payoutAddress: string;
  network: string;
  status: "draft" | "ready";
  website: string;
  description: string;
};

type Offer = SellerOffer;

const NAV: { key: SellerView; label: string; icon: string; group: string }[] = [
  { key: "overview", label: "Overview", icon: "home", group: "Home" },
  { key: "catalog", label: "Catalog", icon: "book", group: "Sell" },
  { key: "integrations", label: "Integrations", icon: "zap", group: "Sell" },
  { key: "directory", label: "Directory", icon: "search", group: "Sell" },
  { key: "versions", label: "Versions", icon: "layers", group: "Sell" },
  { key: "sandbox", label: "Sandbox", icon: "play", group: "Sell" },
  { key: "analytics", label: "Analytics", icon: "chart", group: "Money" },
  { key: "activity", label: "Activity", icon: "list", group: "Money" },
  { key: "billing", label: "Invoices & payouts", icon: "wallet", group: "Money" },
  { key: "policies", label: "Access policies", icon: "shield", group: "Control" },
  { key: "webhooks", label: "Webhooks", icon: "bell", group: "Developers" },
  { key: "developers", label: "Developers", icon: "key", group: "Developers" },
];

const NAV_GROUPS = ["Home", "Sell", "Money", "Control", "Developers"] as const;

const MOBILE_NAV: { key: SellerView; label: string; icon: string }[] = [
  { key: "overview", label: "Home", icon: "home" },
  { key: "catalog", label: "Catalog", icon: "book" },
  { key: "analytics", label: "Analytics", icon: "chart" },
  { key: "billing", label: "Payouts", icon: "wallet" },
];

const VIEW_META: Record<
  SellerView,
  { eyebrow: string; title: string; description: string }
> = {
  overview: {
    eyebrow: "Seller · Overview",
    title: "Get paid by agents on your site.",
    description:
      "Catalog what you sell, attach x402 on your endpoints, and watch inbound USDC settle to your wallet.",
  },
  catalog: {
    eyebrow: "Sell · Catalog",
    title: "Offers agents can purchase.",
    description:
      "Each offer is an endpoint + price. Published offers are listed in the ABI buyer directory by default — opt out per offer to keep it site-only.",
  },
  integrations: {
    eyebrow: "Sell · Integrations",
    title: "Wire x402 on your stack.",
    description:
      "Copy a snippet or bring your own x402 server, then verify an unpaid GET returns HTTP 402.",
  },
  activity: {
    eyebrow: "Money · Activity",
    title: "Inbound settlements.",
    description:
      "When a buyer agent pays through ABI, the unlocked payment appears here with its transaction hash.",
  },
  developers: {
    eyebrow: "Developers",
    title: "Challenge shape and snippets.",
    description:
      "The agent hits your URL, ABI buyer policy pays, your resource unlocks.",
  },
  directory: {
    eyebrow: "Sell · Directory",
    title: "Buyer directory listing.",
    description:
      "Published offers are listed for buyers by default. Opt out per offer to keep it on your site only.",
  },
  versions: {
    eyebrow: "Sell · Versions",
    title: "Version and retire offers safely.",
    description:
      "Ship a new version as a draft, then deprecate the old one with a sunset date and a successor. Buyers get at least 7 days of notice.",
  },
  sandbox: {
    eyebrow: "Sell · Sandbox",
    title: "Let buyers test before paying.",
    description:
      "A simulated payment request and unlock for each offer. Nothing settles and no USDC moves.",
  },
  analytics: {
    eyebrow: "Money · Analytics",
    title: "Usage per endpoint.",
    description: "Who calls each offer, how often, and what it earned.",
  },
  billing: {
    eyebrow: "Money · Invoices & payouts",
    title: "Invoices and wallet payouts.",
    description:
      "Every paid call settles USDC straight to your payout wallet. Invoices summarize those settlements per month.",
  },
  policies: {
    eyebrow: "Control · Access policies",
    title: "Who can call, and how often.",
    description: "Block buyer orgs or agents, and set per-minute or per-day rate limits by offer.",
  },
  webhooks: {
    eyebrow: "Developers · Webhooks",
    title: "Get notified.",
    description: "Signed events for payments received, usage thresholds, policy changes, and deprecations.",
  },
  settings: {
    eyebrow: "Settings",
    title: "Seller profile and payout.",
    description: "Display name, website, and the wallet that receives USDC.",
  },
};

export function SellerConsole({ initialView = "overview" }: { initialView?: SellerView }) {
  const theme = useTheme();
  const [partner, setPartner] = useState<Partner | null>(null);
  const [activeSeller, setActiveSeller] = useState<SellerOrg | null>(null);
  const [view, setView] = useState<SellerView>(initialView);
  const [railOpen, setRailOpen] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [folderOpen, setFolderOpen] = useState<Record<string, boolean>>({
    Home: true,
    Sell: true,
    Money: true,
    Control: true,
    Developers: true,
  });
  const [profile, setProfile] = useState<SellerProfile | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [activity, setActivity] = useState<
    {
      id: string;
      offerId: string | null;
      amountUsdc: string;
      txHash: string | null;
      state: string;
      createdAt: string;
    }[]
  >([]);
  const [busy, setBusy] = useState(false);
  const [snippet, setSnippet] = useState<string | null>(null);
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null);
  const [profileDraft, setProfileDraft] = useState<SellerProfile>({
    displayName: "",
    payoutAddress: "",
    network: "base-sepolia",
    status: "draft",
    website: "",
    description: "",
  });
  const [offerForm, setOfferForm] = useState({
    slug: "",
    title: "",
    endpointUrl: "",
    priceUsdc: "0.10",
    network: "base-sepolia",
  });

  const setToast = useCallback((msg: string, kind: "ok" | "err" | "info" = "info") => {
    toast(msg, kind);
  }, []);

  const selectedOffer =
    offers.find((o) => o.id === selectedOfferId) ?? offers[0] ?? null;

  const refreshSeller = useCallback(async () => {
    const [profileRes, offersRes, activityRes] = await Promise.all([
      apiFetch("/v1/seller/profile"),
      apiFetch("/v1/seller/offers"),
      apiFetch("/v1/seller/activity"),
    ]);
    if (profileRes.ok) {
      const body = (await profileRes.json()) as { profile: SellerProfile };
      setProfile(body.profile);
      setProfileDraft(body.profile);
    }
    if (offersRes.ok) {
      const body = (await offersRes.json()) as { offers: Offer[] };
      setOffers(body.offers);
      setSelectedOfferId((prev) => prev ?? body.offers[0]?.id ?? null);
    }
    if (activityRes.ok) {
      const body = (await activityRes.json()) as { settlements: typeof activity };
      setActivity(body.settlements);
    }
  }, []);

  const refreshMe = useCallback(async (): Promise<boolean> => {
    const me = await apiFetch("/v1/partner/auth/me").catch(() => null);
    if (!me?.ok) return false;
    const body = (await me.json()) as { partner: Partner; org: SellerOrg | null };
    setPartner(body.partner);
    setActiveSeller(body.org);
    return true;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const ok = await refreshMe();
      if (cancelled) return;
      if (!ok) {
        window.location.replace("/partners/login");
        return;
      }
      await refreshSeller();
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshMe, refreshSeller]);

  async function saveProfile() {
    if (!activeSeller) return;
    setBusy(true);
    try {
      const res = await apiFetch("/v1/seller/profile", {
        method: "PATCH",
        body: JSON.stringify(profileDraft),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setToast(body?.error?.message ?? "Could not save profile", "err");
        return;
      }
      const body = (await res.json()) as { profile: SellerProfile };
      setProfile(body.profile);
      setProfileDraft(body.profile);
      setToast("Seller profile saved", "ok");
      await refreshMe();
    } finally {
      setBusy(false);
    }
  }

  async function createOffer() {
    if (!activeSeller) return;
    setBusy(true);
    try {
      const res = await apiFetch("/v1/seller/offers", {
        method: "POST",
        body: JSON.stringify(offerForm),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setToast(body?.error?.message ?? "Could not create offer", "err");
        return;
      }
      const body = (await res.json()) as { offer: Offer };
      setOffers((prev) => [body.offer, ...prev]);
      setSelectedOfferId(body.offer.id);
      setOfferForm({
        slug: "",
        title: "",
        endpointUrl: "",
        priceUsdc: "0.10",
        network: profileDraft.network || "base-sepolia",
      });
      setToast("Offer created", "ok");
      setView("integrations");
    } finally {
      setBusy(false);
    }
  }

  async function verifyOffer(offerId: string) {
    if (!activeSeller) return;
    setBusy(true);
    try {
      const res = await apiFetch(`/v1/seller/offers/${offerId}/verify`, {
        method: "POST",
        body: "{}",
      });
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: { message?: string };
        offer?: Offer;
      } | null;
      if (body?.offer) {
        setOffers((prev) => prev.map((o) => (o.id === body.offer!.id ? body.offer! : o)));
      }
      if (!res.ok || body?.ok === false) {
        setToast(body?.error?.message ?? "Verify failed", "err");
        return;
      }
      setToast("Offer verified (402 challenge OK)", "ok");
    } finally {
      setBusy(false);
    }
  }

  async function publishOffer(offerId: string) {
    if (!activeSeller) return;
    setBusy(true);
    try {
      const res = await apiFetch(`/v1/seller/offers/${offerId}/publish`, {
        method: "POST",
        body: "{}",
      });
      const body = (await res.json().catch(() => null)) as {
        error?: { message?: string };
        offer?: Offer;
      } | null;
      if (!res.ok) {
        setToast(body?.error?.message ?? "Publish failed", "err");
        return;
      }
      if (body?.offer) {
        setOffers((prev) => prev.map((o) => (o.id === body.offer!.id ? body.offer! : o)));
      }
      setToast(
        body?.offer?.directoryListed === false
          ? "Offer published (hidden from the buyer directory)"
          : "Offer published and listed in the buyer directory",
        "ok",
      );
    } finally {
      setBusy(false);
    }
  }

  async function loadSnippet(offerId: string) {
    if (!activeSeller) return;
    setBusy(true);
    try {
      const res = await apiFetch(`/v1/seller/offers/${offerId}/snippet`);
      if (!res.ok) {
        setToast("Could not load snippet", "err");
        return;
      }
      const body = (await res.json()) as { snippet: string };
      setSnippet(body.snippet);
      setToast("Snippet ready", "ok");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await apiFetch("/v1/partner/auth/logout", { method: "POST", body: "{}" }).catch(() => null);
    window.location.assign("/partners/login");
  }

  if (!partner) return null;

  const meta = VIEW_META[view];
  const published = offers.filter((o) => o.status === "published").length;
  const verified = offers.filter((o) => o.status === "verified" || o.status === "published").length;

  return (
    <TooltipProvider delayDuration={250}>
      <div className={`app ${railOpen ? "rail-open" : ""} ${railCollapsed ? "nav-collapsed" : ""}`}>
        <button
          type="button"
          className="rail-burger"
          aria-label={railOpen ? "Close navigation" : "Open navigation"}
          onClick={() => setRailOpen((v) => !v)}
        >
          <Icon name="list" />
        </button>
        {railOpen && (
          <button
            type="button"
            className="rail-scrim"
            aria-label="Close navigation"
            onClick={() => setRailOpen(false)}
          />
        )}
        <Sidebar className="rail rail-folders" label="Seller navigation">
          <div className="rail-brand-row">
            <Link
              href="/partnerships"
              className="rail-brand"
              title="Partnerships"
              style={{ textDecoration: "none" }}
            >
              <ABAppIcon size={38} />
              <span>
                <b>ABI Seller</b>
                <small>Partner console</small>
              </span>
            </Link>
            <button
              type="button"
              className="rail-collapse"
              aria-label={railCollapsed ? "Expand navigation" : "Collapse navigation"}
              onClick={() => {
                const next = !railCollapsed;
                setRailCollapsed(next);
                setFolderOpen({ Home: true, Sell: true, Money: true, Control: true, Developers: true });
              }}
            >
              <Icon name={railCollapsed ? "arrowRight" : "arrowLeft"} size={15} />
            </button>
          </div>
          {NAV_GROUPS.map((group) => {
            const items = NAV.filter((n) => n.group === group);
            return (
              <SidebarFolder
                key={group}
                title={group}
                open={folderOpen[group] ?? true}
                onOpenChange={(open) => setFolderOpen((s) => ({ ...s, [group]: open }))}
                active={items.some((n) => n.key === view)}
              >
                {items.map((n) => (
                  <SidebarItem
                    key={n.key}
                    nested
                    active={view === n.key}
                    label={n.label}
                    onClick={() => {
                      setView(n.key);
                      setRailOpen(false);
                    }}
                  >
                    <Icon name={n.icon} />
                  </SidebarItem>
                ))}
              </SidebarFolder>
            );
          })}
          <div className="rail-spacer" />
          <SidebarItem
            nested
            active={view === "settings"}
            label="Settings"
            onClick={() => {
              setView("settings");
              setRailOpen(false);
            }}
          >
            <Icon name="gear" />
          </SidebarItem>
        </Sidebar>

        <main className="main">
          <header className="topbar">
            <div className="topbar-title-block">
              <nav className="crumb" aria-label="Breadcrumb">
                <span className="crumb-group">Seller</span>
                <span className="crumb-sep" aria-hidden>
                  /
                </span>
                <span className="crumb-current">{NAV.find((n) => n.key === view)?.label ?? "Settings"}</span>
              </nav>
              <h1>{NAV.find((n) => n.key === view)?.label ?? "Settings"}</h1>
            </div>
            <div className="spacer" />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="user-chip" aria-label="Account menu">
                  <div className="avatar">
                    {(activeSeller?.name ?? "SL").slice(0, 2).toUpperCase()}
                  </div>
                  <div className="who">
                    <b>{activeSeller?.name ?? "Seller"}</b>
                    <span>{partner.email}</span>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>{activeSeller?.name ?? "Seller"}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setView("settings")}>Settings</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => theme.toggle()}>
                  Theme: {theme.resolved === "dark" ? "Dark" : "Light"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void signOut()}>Log out</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </header>

          <div className="scroll">
              <section className="view">
                <header className="view-head" style={{ marginBottom: 18 }}>
                  <p className="eyebrow">{meta.eyebrow}</p>
                  <h2 style={{ margin: "4px 0 8px", letterSpacing: "-0.02em" }}>{meta.title}</h2>
                  <p className="muted" style={{ maxWidth: 640 }}>
                    {meta.description}
                  </p>
                </header>

                {view === "overview" && (
                  <div className="grid-3" style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
                    <div className="card">
                      <span className="muted">Profile</span>
                      <b style={{ display: "block", marginTop: 6, fontSize: 20 }}>
                        {profile?.status === "ready" ? "Ready" : "Draft"}
                      </b>
                    </div>
                    <div className="card">
                      <span className="muted">Offers</span>
                      <b style={{ display: "block", marginTop: 6, fontSize: 20 }}>{offers.length}</b>
                    </div>
                    <div className="card">
                      <span className="muted">Verified / published</span>
                      <b style={{ display: "block", marginTop: 6, fontSize: 20 }}>
                        {verified} / {published}
                      </b>
                    </div>
                    <div className="card" style={{ gridColumn: "1 / -1" }}>
                      <h3 style={{ marginTop: 0 }}>How agents pay</h3>
                      <ol className="muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
                        <li>Agent finds your offer in the ABI buyer directory or on your website.</li>
                        <li>Your server returns an x402 payment challenge (ABI snippet or BYO).</li>
                        <li>The agent’s buyer org evaluates policy and pays USDC to your wallet.</li>
                        <li>Your resource unlocks; the settlement shows under Activity.</li>
                      </ol>
                      <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
                        <Button onClick={() => setView("catalog")}>Open catalog</Button>
                        <Button variant="secondary" onClick={() => setView("settings")}>
                          Edit payout profile
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {view === "catalog" && (
                  <div style={{ display: "grid", gap: 16, maxWidth: 820 }}>
                    <div className="card">
                      <h3 style={{ marginTop: 0 }}>New offer</h3>
                      <div
                        style={{
                          display: "grid",
                          gap: 10,
                          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                        }}
                      >
                        <label className="field">
                          <span>Slug</span>
                          <input
                            value={offerForm.slug}
                            onChange={(e) =>
                              setOfferForm({ ...offerForm, slug: e.target.value.toLowerCase() })
                            }
                            placeholder="market-report"
                          />
                        </label>
                        <label className="field">
                          <span>Title</span>
                          <input
                            value={offerForm.title}
                            onChange={(e) => setOfferForm({ ...offerForm, title: e.target.value })}
                            placeholder="Market report"
                          />
                        </label>
                        <label className="field" style={{ gridColumn: "1 / -1" }}>
                          <span>Endpoint URL (on your site)</span>
                          <input
                            value={offerForm.endpointUrl}
                            onChange={(e) =>
                              setOfferForm({ ...offerForm, endpointUrl: e.target.value })
                            }
                            placeholder="https://api.yoursite.com/report"
                          />
                        </label>
                        <label className="field">
                          <span>Price (USDC)</span>
                          <input
                            value={offerForm.priceUsdc}
                            onChange={(e) =>
                              setOfferForm({ ...offerForm, priceUsdc: e.target.value })
                            }
                          />
                        </label>
                        <label className="field">
                          <span>Network</span>
                          <select
                            value={offerForm.network}
                            onChange={(e) =>
                              setOfferForm({ ...offerForm, network: e.target.value })
                            }
                          >
                            <option value="base-sepolia">Base Sepolia</option>
                            <option value="base">Base</option>
                          </select>
                        </label>
                      </div>
                      <Button
                        style={{ marginTop: 12 }}
                        disabled={busy}
                        onClick={() => void createOffer()}
                      >
                        Add offer
                      </Button>
                    </div>
                    <div className="card">
                      <h3 style={{ marginTop: 0 }}>Your catalog</h3>
                      {offers.length === 0 ? (
                        <p className="muted">No offers yet. Add one to start integrating x402.</p>
                      ) : (
                        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                          {offers.map((o) => (
                            <li
                              key={o.id}
                              style={{
                                padding: "12px 0",
                                borderTop: "1px solid var(--color-border)",
                                display: "flex",
                                justifyContent: "space-between",
                                gap: 12,
                                flexWrap: "wrap",
                              }}
                            >
                              <div>
                                <b>{o.title}</b>
                                <div className="muted" style={{ fontSize: 12.5 }}>
                                  {o.slug} · {o.priceUsdc} USDC · {o.status}
                                </div>
                                <div className="muted" style={{ fontSize: 12 }}>
                                  {o.endpointUrl}
                                </div>
                              </div>
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => {
                                  setSelectedOfferId(o.id);
                                  setView("integrations");
                                }}
                              >
                                Integrate
                              </Button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )}

                {view === "integrations" && (
                  <div style={{ display: "grid", gap: 16, maxWidth: 860 }}>
                    {offers.length === 0 ? (
                      <div className="card">
                        <p className="muted">Create an offer in Catalog first.</p>
                        <Button onClick={() => setView("catalog")}>Go to catalog</Button>
                      </div>
                    ) : (
                      <>
                        <div className="card">
                          <label className="field">
                            <span>Offer</span>
                            <select
                              value={selectedOffer?.id ?? ""}
                              onChange={(e) => setSelectedOfferId(e.target.value)}
                            >
                              {offers.map((o) => (
                                <option key={o.id} value={o.id}>
                                  {o.title} ({o.status})
                                </option>
                              ))}
                            </select>
                          </label>
                          {selectedOffer && (
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                              <Button
                                disabled={busy}
                                onClick={() => void loadSnippet(selectedOffer.id)}
                              >
                                Copy snippet
                              </Button>
                              <Button
                                variant="secondary"
                                disabled={busy}
                                onClick={() => void verifyOffer(selectedOffer.id)}
                              >
                                Verify unpaid 402
                              </Button>
                              <Button
                                variant="secondary"
                                disabled={busy || selectedOffer.status === "draft"}
                                onClick={() => void publishOffer(selectedOffer.id)}
                              >
                                Publish
                              </Button>
                            </div>
                          )}
                          {selectedOffer?.integration.error && (
                            <p style={{ color: "var(--color-danger)", marginTop: 12 }}>
                              {selectedOffer.integration.error}
                            </p>
                          )}
                          {selectedOffer?.integration.lastVerifiedAt && (
                            <p className="muted" style={{ marginTop: 12 }}>
                              Last verified {selectedOffer.integration.lastVerifiedAt}
                            </p>
                          )}
                        </div>
                        {snippet && (
                          <div className="card">
                            <h3 style={{ marginTop: 0 }}>Snippet v0</h3>
                            <pre
                              style={{
                                whiteSpace: "pre-wrap",
                                fontSize: 12,
                                background: "var(--color-surface-2)",
                                padding: 14,
                                borderRadius: 12,
                                overflow: "auto",
                              }}
                            >
                              {snippet}
                            </pre>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={async () => {
                                await navigator.clipboard.writeText(snippet);
                                setToast("Snippet copied", "ok");
                              }}
                            >
                              Copy to clipboard
                            </Button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}

                {view === "activity" && (
                  <div className="card" style={{ maxWidth: 820 }}>
                    <h3 style={{ marginTop: 0 }}>Inbound payments</h3>
                    {activity.length === 0 ? (
                      <p className="muted">
                        No settlements yet. After a buyer agent pays an offer on your site, the
                        transaction lands here.
                      </p>
                    ) : (
                      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                        {activity.map((row) => (
                          <li
                            key={row.id}
                            style={{
                              padding: "10px 0",
                              borderTop: "1px solid var(--color-border)",
                            }}
                          >
                            <b>{row.amountUsdc} USDC</b> · {row.state}
                            <div className="muted" style={{ fontSize: 12 }}>
                              {row.txHash ?? "pending hash"} · {row.createdAt}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {view === "developers" && (
                  <div className="card" style={{ maxWidth: 820 }}>
                    <h3 style={{ marginTop: 0 }}>Payment path</h3>
                    <p className="muted">
                      Published offers are listed in the ABI buyer directory unless you opt out
                      (Directory). When an agent requests the paid URL, return x402; the agent’s
                      buyer policy path settles USDC to your payout address and retries to unlock.
                    </p>
                    <ul className="muted" style={{ lineHeight: 1.6 }}>
                      <li>Required unpaid response: HTTP 402</li>
                      <li>payTo must match your seller profile payout address</li>
                      <li>Network and price must match the catalog offer</li>
                      <li>Use Integrations → Verify before Publish</li>
                    </ul>
                    <Button variant="secondary" onClick={() => setView("integrations")}>
                      Open integrations
                    </Button>
                  </div>
                )}

                {view === "directory" && (
                  <DirectoryView offers={offers} onOffersChanged={refreshSeller} />
                )}
                {view === "versions" && (
                  <VersionsView offers={offers} onOffersChanged={refreshSeller} />
                )}
                {view === "sandbox" && (
                  <SandboxView offers={offers} onOffersChanged={refreshSeller} />
                )}
                {view === "analytics" && <AnalyticsView />}
                {view === "billing" && <BillingView />}
                {view === "policies" && <PoliciesView offers={offers} />}
                {view === "webhooks" && <WebhooksView offers={offers} />}

                {view === "settings" && (
                  <div className="card" style={{ maxWidth: 640 }}>
                    <div style={{ display: "grid", gap: 12 }}>
                      <label className="field">
                        <span>Display name</span>
                        <input
                          value={profileDraft.displayName}
                          onChange={(e) =>
                            setProfileDraft({ ...profileDraft, displayName: e.target.value })
                          }
                        />
                      </label>
                      <label className="field">
                        <span>Payout address</span>
                        <input
                          value={profileDraft.payoutAddress}
                          onChange={(e) =>
                            setProfileDraft({ ...profileDraft, payoutAddress: e.target.value })
                          }
                          placeholder="0x…"
                          spellCheck={false}
                        />
                      </label>
                      <label className="field">
                        <span>Network</span>
                        <select
                          value={profileDraft.network}
                          onChange={(e) =>
                            setProfileDraft({ ...profileDraft, network: e.target.value })
                          }
                        >
                          <option value="base-sepolia">Base Sepolia</option>
                          <option value="base">Base</option>
                        </select>
                      </label>
                      <label className="field">
                        <span>Website</span>
                        <input
                          value={profileDraft.website}
                          onChange={(e) =>
                            setProfileDraft({ ...profileDraft, website: e.target.value })
                          }
                          placeholder="https://"
                        />
                      </label>
                      <label className="field">
                        <span>Description</span>
                        <textarea
                          value={profileDraft.description}
                          onChange={(e) =>
                            setProfileDraft({ ...profileDraft, description: e.target.value })
                          }
                          rows={3}
                        />
                      </label>
                      <Button disabled={busy} onClick={() => void saveProfile()}>
                        {busy ? "Saving…" : "Save profile"}
                      </Button>
                    </div>
                  </div>
                )}
              </section>
          </div>
        </main>

        <nav className="mobile-bottom-nav" aria-label="Seller navigation">
          {MOBILE_NAV.map((item) => (
            <button
              type="button"
              key={item.key}
              className={view === item.key ? "active" : ""}
              aria-current={view === item.key ? "page" : undefined}
              onClick={() => {
                setView(item.key);
                setRailOpen(false);
              }}
            >
              <span className="mobile-nav-icon">
                <Icon name={item.icon} size={19} />
              </span>
              <span>{item.label}</span>
            </button>
          ))}
          <button
            type="button"
            className={railOpen ? "active" : ""}
            aria-expanded={railOpen}
            onClick={() => setRailOpen((open) => !open)}
          >
            <span className="mobile-nav-icon">
              <Icon name="list" size={19} />
            </span>
            <span>More</span>
          </button>
        </nav>
      </div>
    </TooltipProvider>
  );
}
