"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ABAppIcon } from "./brand";
import { browserApiBase } from "./browser-api";
import { readCsrfCookie } from "./sign-out";
import { Icon } from "./ui";

const API = browserApiBase();

export type SellerOrg = { id: string; name: string; kind: "buyer" | "seller"; role: string };

export type SellerProfile = {
  displayName: string;
  payoutAddress: string;
  network: string;
  status: "draft" | "ready";
  website: string;
  description: string;
  updatedAt?: string;
};

type MeResponse = {
  user: { id: string; email: string; name: string };
  orgs: SellerOrg[];
  csrfToken?: string | null;
};

async function apiFetch(path: string, init: RequestInit & { orgId?: string } = {}) {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const csrf = readCsrfCookie(typeof document !== "undefined" ? document.cookie : "");
  if (csrf && init.method && init.method.toUpperCase() !== "GET") {
    headers.set("x-abi-csrf", csrf);
  }
  if (init.orgId) headers.set("x-abi-org", init.orgId);
  const { orgId: _orgId, ...rest } = init;
  return fetch(`${API}${path}`, { ...rest, headers, credentials: "include" });
}

export function SellerShell({ active }: { active: "overview" | "settings" | "directory" }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [sellerOrgId, setSellerOrgId] = useState<string | null>(null);
  const [profile, setProfile] = useState<SellerProfile | null>(null);
  const [directoryOffers, setDirectoryOffers] = useState<unknown[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<SellerProfile>({
    displayName: "",
    payoutAddress: "",
    network: "base-sepolia",
    status: "draft",
    website: "",
    description: "",
  });
  const [notice, setNotice] = useState<string | null>(null);

  const sellerOrgs = useMemo(
    () => (me?.orgs ?? []).filter((o) => o.kind === "seller"),
    [me],
  );
  const buyerOrgs = useMemo(() => (me?.orgs ?? []).filter((o) => o.kind === "buyer"), [me]);
  const activeSeller = sellerOrgs.find((o) => o.id === sellerOrgId) ?? sellerOrgs[0] ?? null;

  const refresh = useCallback(async () => {
    setError(null);
    const meRes = await apiFetch("/v1/auth/me");
    if (meRes.status === 401) {
      setMe(null);
      setProfile(null);
      setLoaded(true);
      return;
    }
    if (!meRes.ok) {
      setError("Could not load your session.");
      setLoaded(true);
      return;
    }
    const meBody = (await meRes.json()) as MeResponse;
    setMe(meBody);
    const sellers = meBody.orgs.filter((o) => o.kind === "seller");
    const nextId =
      (sellerOrgId && sellers.some((o) => o.id === sellerOrgId) ? sellerOrgId : null) ??
      sellers[0]?.id ??
      null;
    setSellerOrgId(nextId);

    if (active === "directory") {
      const dirRes = await apiFetch("/v1/directory/offers");
      if (dirRes.ok) {
        const dirBody = (await dirRes.json()) as { offers: unknown[] };
        setDirectoryOffers(dirBody.offers);
      } else {
        setDirectoryOffers([]);
      }
    }

    if (!nextId) {
      setProfile(null);
      setLoaded(true);
      return;
    }
    const profileRes = await apiFetch("/v1/seller/profile", { orgId: nextId });
    if (!profileRes.ok) {
      setError("Could not load seller profile.");
      setLoaded(true);
      return;
    }
    const profileBody = (await profileRes.json()) as { profile: SellerProfile };
    setProfile(profileBody.profile);
    setDraft(profileBody.profile);
    setLoaded(true);
  }, [active, sellerOrgId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function createSellerOrg() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch("/v1/seller/orgs", {
        method: "POST",
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setError(body?.error?.message ?? "Could not create a seller organization.");
        return;
      }
      const body = (await res.json()) as { org: { id: string } };
      setSellerOrgId(body.org.id);
      setNotice("Seller organization created. Buyer and seller floats stay separate.");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function saveProfile() {
    if (!activeSeller) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch("/v1/seller/profile", {
        method: "PATCH",
        orgId: activeSeller.id,
        body: JSON.stringify({
          displayName: draft.displayName,
          payoutAddress: draft.payoutAddress,
          network: draft.network,
          website: draft.website,
          description: draft.description,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setError(body?.error?.message ?? "Could not save seller profile.");
        return;
      }
      const body = (await res.json()) as { profile: SellerProfile };
      setProfile(body.profile);
      setDraft(body.profile);
      setNotice("Seller profile saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="seller-app">
      <header className="seller-top">
        <Link href="/seller" className="seller-brand" aria-label="Seller home">
          <ABAppIcon size={28} />
          <span>ABI Seller</span>
        </Link>
        <nav className="seller-switch" aria-label="Workspace switcher">
          <Link
            href="/console"
            className={buyerOrgs.length ? "switch-chip" : "switch-chip"}
          >
            Buyer
          </Link>
          <span className="switch-chip active">Seller</span>
          <Link href="/directory" className="switch-chip">
            Directory
          </Link>
        </nav>
        <div className="seller-who">
          <b>{activeSeller?.name ?? (loaded ? "No seller org" : "Loading…")}</b>
          <span>{me?.user.email ?? "Sign in required"}</span>
        </div>
      </header>

      <div className="seller-layout">
        <aside className="seller-rail" aria-label="Seller navigation">
          <Link
            href="/seller"
            className={active === "overview" ? "rail-item active" : "rail-item"}
          >
            <Icon name="home" />
            Overview
          </Link>
          <Link
            href="/seller/settings"
            className={active === "settings" ? "rail-item active" : "rail-item"}
          >
            <Icon name="gear" />
            Profile
          </Link>
          <Link
            href="/directory"
            className={active === "directory" ? "rail-item active" : "rail-item"}
          >
            <Icon name="search" />
            Directory
          </Link>
        </aside>

        <main className="seller-main">
          {error && <div className="seller-banner bad">{error}</div>}
          {notice && <div className="seller-banner ok">{notice}</div>}

          {!loaded ? (
            <section className="seller-panel">
              <p className="muted">Loading seller workspace…</p>
            </section>
          ) : !me ? (
            <section className="seller-panel">
              <h1>Sign in to sell to agents</h1>
              <p className="muted">
                Seller tools use your ABI account. Create a dedicated seller organization — never
                your buyer float.
              </p>
              <div className="seller-actions">
                <Link className="btn-primary-line" href="/console">
                  Open console to sign in
                </Link>
              </div>
            </section>
          ) : active === "directory" ? (
            <section className="seller-panel">
              <p className="eyebrow">Discovery</p>
              <h1>Service directory</h1>
              <p className="muted">
                Early directory stub. Published offers will appear here after Phase 1 verify +
                publish.
              </p>
              <div className="directory-list">
                {(directoryOffers?.length ?? 0) === 0
                  ? "No published offers yet."
                  : `${directoryOffers?.length} offer(s)`}
              </div>
            </section>
          ) : !activeSeller ? (
            <section className="seller-panel">
              <p className="eyebrow">Get paid by agents</p>
              <h1>Create a seller organization</h1>
              <p className="muted">
                Partners keep a separate seller org from their buyer float. Same login, different
                organization — payouts go to your wallet via x402.
              </p>
              <div className="seller-actions">
                <button
                  type="button"
                  className="btn-primary-line"
                  disabled={busy}
                  onClick={() => void createSellerOrg()}
                >
                  {busy ? "Creating…" : "Create seller org"}
                </button>
              </div>
            </section>
          ) : active === "settings" ? (
            <section className="seller-panel">
              <p className="eyebrow">Settings · Profile</p>
              <h1>Seller profile</h1>
              <p className="muted">
                Settlement destination and public details for offers you will publish later.
              </p>
              <div className="seller-form">
                <label>
                  Display name
                  <input
                    value={draft.displayName}
                    onChange={(e) => setDraft({ ...draft, displayName: e.target.value })}
                    maxLength={80}
                  />
                </label>
                <label>
                  Payout address
                  <input
                    value={draft.payoutAddress}
                    onChange={(e) => setDraft({ ...draft, payoutAddress: e.target.value })}
                    placeholder="0x…"
                    spellCheck={false}
                  />
                </label>
                <label>
                  Network
                  <select
                    value={draft.network}
                    onChange={(e) => setDraft({ ...draft, network: e.target.value })}
                  >
                    <option value="base-sepolia">Base Sepolia</option>
                    <option value="base">Base</option>
                  </select>
                </label>
                <label>
                  Website
                  <input
                    value={draft.website}
                    onChange={(e) => setDraft({ ...draft, website: e.target.value })}
                    placeholder="https://"
                  />
                </label>
                <label>
                  Description
                  <textarea
                    value={draft.description}
                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                    rows={3}
                    maxLength={1000}
                  />
                </label>
                <div className="seller-actions">
                  <button
                    type="button"
                    className="btn-primary-line"
                    disabled={busy}
                    onClick={() => void saveProfile()}
                  >
                    {busy ? "Saving…" : "Save profile"}
                  </button>
                  <span className={`status-pill ${profile?.status === "ready" ? "ready" : "draft"}`}>
                    {profile?.status === "ready" ? "Ready" : "Draft"}
                  </span>
                </div>
              </div>
            </section>
          ) : (
            <section className="seller-panel">
              <p className="eyebrow">Seller · Overview</p>
              <h1>{activeSeller.name}</h1>
              <p className="muted">
                Phase 0 shell: profile and discovery first. Offers, verify, and payments land in
                later phases.
              </p>
              <div className="seller-stats">
                <div>
                  <span>Profile</span>
                  <b>{profile?.status === "ready" ? "Ready" : "Draft"}</b>
                </div>
                <div>
                  <span>Network</span>
                  <b>{profile?.network ?? "base-sepolia"}</b>
                </div>
                <div>
                  <span>Offers</span>
                  <b>0</b>
                </div>
              </div>
              <div className="seller-actions">
                <Link className="btn-primary-line" href="/seller/settings">
                  Edit seller profile
                </Link>
                <Link className="btn-secondary-line" href="/directory">
                  View directory
                </Link>
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
