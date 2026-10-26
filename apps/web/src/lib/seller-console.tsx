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
  Stat,
  WebhooksView,
  type SellerOffer,
} from "./seller-features";
import {
  ActivityView,
  CatalogView,
  IntegrationsView,
  type SellerActivityRow,
} from "./seller-catalog";
import { SellerSettingsView, type SellerProfile } from "./seller-settings";
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

const VIEW_META: Record<SellerView, { eyebrow: string; title: string; description: string }> = {
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
      "Each offer is a paid URL and a price. ABI can host it, or point it at your own server. Published offers are listed in the buyer directory unless you opt out.",
  },
  integrations: {
    eyebrow: "Sell · Integrations",
    title: "Take payment on the offer URL.",
    description:
      "Hosted offers need nothing deployed. For your own server, copy the x402 code for your stack. Then verify an unpaid GET returns the right 402 and publish.",
  },
  activity: {
    eyebrow: "Money · Activity",
    title: "Inbound settlements.",
    description:
      "Every sale, the buyer who paid, and the on-chain transaction that settled it to your wallet.",
  },
  developers: {
    eyebrow: "Developers",
    title: "Challenge shape and snippets.",
    description: "The agent hits your URL, ABI buyer policy pays, your resource unlocks.",
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
    title: "Let buyers try an offer before paying.",
    description:
      "A free dry run for integrators: it shows the real 402 challenge and runs your access policy, but nothing is signed and no USDC moves.",
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
    description:
      "Open to every buyer or approved customers only, block abusers, and cap calls per minute or per day. Enforced before any payment is taken.",
  },
  webhooks: {
    eyebrow: "Developers · Webhooks",
    title: "Get notified.",
    description:
      "Signed events for payments received, usage thresholds, policy changes, and deprecations.",
  },
  settings: {
    eyebrow: "Settings",
    title: "Company, payout and security.",
    description:
      "Your public profile, the wallet that receives USDC, your account, two-factor, and signed-in sessions.",
  },
};

function viewPath(view: SellerView): string {
  return view === "overview" ? "/seller" : `/seller/${view}`;
}

function viewFromPath(pathname: string): SellerView | null {
  const seg = pathname.replace(/\/+$/, "").split("/")[2] ?? "overview";
  return (seg in VIEW_META ? seg : null) as SellerView | null;
}

export function SellerConsole({ initialView = "overview" }: { initialView?: SellerView }) {
  const theme = useTheme();
  const [partner, setPartner] = useState<Partner | null>(null);
  const [activeSeller, setActiveSeller] = useState<SellerOrg | null>(null);
  const [view, setViewState] = useState<SellerView>(initialView);
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
  const [activity, setActivity] = useState<SellerActivityRow[]>([]);
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null);

  const setView = useCallback((next: SellerView) => {
    setViewState(next);
    if (typeof window !== "undefined" && window.location.pathname !== viewPath(next)) {
      window.history.pushState({ view: next }, "", viewPath(next));
    }
  }, []);

  useEffect(() => {
    const onPop = () => {
      const v = viewFromPath(window.location.pathname);
      if (v) setViewState(v);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const refreshSeller = useCallback(async () => {
    const [profileRes, offersRes, activityRes] = await Promise.all([
      apiFetch("/v1/seller/profile"),
      apiFetch("/v1/seller/offers"),
      apiFetch("/v1/seller/activity"),
    ]);
    if (profileRes.ok) {
      const body = (await profileRes.json()) as { profile: SellerProfile };
      setProfile(body.profile);
    }
    if (offersRes.ok) {
      const body = (await offersRes.json()) as { offers: Offer[] };
      setOffers(body.offers);
      setSelectedOfferId((prev) =>
        prev && body.offers.some((o) => o.id === prev) ? prev : (body.offers[0]?.id ?? null),
      );
    }
    if (activityRes.ok) {
      const body = (await activityRes.json()) as { settlements: SellerActivityRow[] };
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

  const goToLogin = useCallback(() => {
    window.location.assign("/partners/login");
  }, []);

  async function signOut() {
    await apiFetch("/v1/partner/auth/logout", { method: "POST", body: "{}" }).catch(() => null);
    toast("Signed out", "ok");
    goToLogin();
  }

  if (!partner) return null;

  const meta = VIEW_META[view];
  const published = offers.filter((o) => o.status === "published").length;
  const verified = offers.filter((o) => o.status === "verified" || o.status === "published").length;
  const earned = activity
    .reduce((sum, r) => sum + Number.parseFloat(r.amountUsdc || "0"), 0)
    .toFixed(2);
  const viewLabel = NAV.find((n) => n.key === view)?.label ?? "Settings";

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
                setFolderOpen({
                  Home: true,
                  Sell: true,
                  Money: true,
                  Control: true,
                  Developers: true,
                });
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
          <SidebarItem nested label="Log out" onClick={() => void signOut()}>
            <Icon name="logout" />
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
                <span className="crumb-current">{viewLabel}</span>
              </nav>
              <h1>{viewLabel}</h1>
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
                <h2 style={{ margin: "0 0 8px", letterSpacing: "-0.02em" }}>{meta.title}</h2>
                <p className="muted" style={{ maxWidth: 640 }}>
                  {meta.description}
                </p>
              </header>

              {view === "overview" && (
                <div
                  style={{
                    display: "grid",
                    gap: 12,
                    gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
                  }}
                >
                  <Stat label="Payout wallet" value={profile?.payoutAddress ? "Set" : "Missing"} />
                  <Stat label="Offers" value={offers.length} />
                  <Stat label="Verified / published" value={`${verified} / ${published}`} />
                  <Stat label="Earned (USDC)" value={earned} />
                  <div className="card" style={{ gridColumn: "1 / -1" }}>
                    <h3 style={{ marginTop: 0 }}>How agents pay you</h3>
                    <ol className="muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
                      <li>Set the wallet that receives USDC in Settings → Payout.</li>
                      <li>
                        Add an offer. ABI can host it for you, or your own server returns the x402
                        challenge.
                      </li>
                      <li>
                        Verify the unpaid 402, then publish. It appears in the buyer directory.
                      </li>
                      <li>
                        A buyer agent pays within its org’s policy. USDC settles on-chain to your
                        wallet and the sale shows under Activity.
                      </li>
                    </ol>
                    <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
                      <Button onClick={() => setView("catalog")}>Open catalog</Button>
                      <Button variant="secondary" onClick={() => setView("settings")}>
                        Payout settings
                      </Button>
                    </div>
                  </div>
                  {activity.length > 0 && (
                    <div style={{ gridColumn: "1 / -1" }}>
                      <ActivityView rows={activity.slice(0, 5)} />
                    </div>
                  )}
                </div>
              )}

              {view === "catalog" && (
                <CatalogView
                  offers={offers}
                  defaultNetwork={profile?.network ?? "base-sepolia"}
                  onOffersChanged={refreshSeller}
                  onIntegrate={(id) => {
                    setSelectedOfferId(id);
                    setView("integrations");
                  }}
                />
              )}

              {view === "integrations" && (
                <IntegrationsView
                  offers={offers}
                  selectedOfferId={selectedOfferId}
                  onSelect={setSelectedOfferId}
                  onOffersChanged={refreshSeller}
                  hasPayoutAddress={Boolean(profile?.payoutAddress)}
                  onOpenSettings={() => setView("settings")}
                />
              )}

              {view === "activity" && <ActivityView rows={activity} />}

              {view === "developers" && (
                <div className="card" style={{ maxWidth: 820 }}>
                  <h3 style={{ marginTop: 0 }}>Payment path</h3>
                  <p className="muted">
                    A buyer agent requests your paid URL and gets HTTP 402 with a PAYMENT-REQUIRED
                    header. Its org’s ABI policy decides, signs a USDC transfer to your payout
                    address, and retries with PAYMENT-SIGNATURE. The facilitator settles on Base and
                    the resource unlocks.
                  </p>
                  <ul className="muted" style={{ lineHeight: 1.6 }}>
                    <li>ABI-hosted offers: nothing to deploy; ABI is the x402 server.</li>
                    <li>Your own server: use the Express, Hono or Next.js code in Integrations.</li>
                    <li>
                      payTo must match your payout address; network and price must match the offer.
                    </li>
                    <li>A URL pays exactly one seller. Verify before publish.</li>
                    <li>Signed webhooks report each sale (Developers → Webhooks).</li>
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
              {view === "policies" && (
                <PoliciesView offers={offers} onOffersChanged={refreshSeller} />
              )}
              {view === "webhooks" && <WebhooksView offers={offers} />}

              {view === "settings" && (
                <SellerSettingsView
                  profile={profile}
                  onProfileSaved={(p) => {
                    setProfile(p);
                    void refreshMe();
                  }}
                  onSignedOut={goToLogin}
                />
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
