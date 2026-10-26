"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { fetchDirectory, type DirectoryOffer } from "../../lib/connections-panel";
import { MarketingShell, SectionHead } from "../../lib/marketing-shell";

export default function DirectoryPage() {
  const [offers, setOffers] = useState<DirectoryOffer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetchDirectory()
      .then(setOffers)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (offers ?? []).filter(
      (o) =>
        !q ||
        [o.title, o.description, o.category, o.seller.name].join(" ").toLowerCase().includes(q),
    );
  }, [offers, query]);

  return (
    <MarketingShell active="partnerships">
      <section className="mkt-page">
        <div className="mkt-page-inner">
          <SectionHead
            title="Businesses your agents can buy from."
            sub="Every published offer from ABI sellers. Connect one from the buyer console Playground and your agent pays it in USDC under your org's policy."
          />
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 20 }}>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search offers or sellers"
              aria-label="Search offers or sellers"
              style={{ flex: "1 1 260px", maxWidth: 420 }}
            />
            <Link href="/console" className="btn-primary">
              Connect from the buyer console
            </Link>
            <Link href="/partners/login?mode=signup" className="btn-ghost">
              List your business
            </Link>
          </div>
          {error ? (
            <p className="muted">The directory is unavailable right now ({error}).</p>
          ) : offers === null ? (
            <p className="muted">Loading…</p>
          ) : visible.length === 0 ? (
            <p className="muted">No published offers yet.</p>
          ) : (
            <div className="mkt-price-grid" data-testid="directory-grid">
              {visible.map((o) => (
                <article key={o.id} className="mkt-price-card">
                  <header>
                    <h3>{o.title}</h3>
                    <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
                      {o.seller.name} · {o.category}
                    </p>
                  </header>
                  {o.description && (
                    <p className="muted" style={{ margin: "0 0 10px", lineHeight: 1.55 }}>
                      {o.description}
                    </p>
                  )}
                  <p style={{ margin: 0, fontSize: 14 }}>
                    <b>{o.priceUsdc} USDC</b>{" "}
                    <span className="muted">
                      per call on {o.network === "base" ? "Base" : "Base Sepolia"}
                      {o.accessMode === "allowlist" ? " · approved buyers only" : ""}
                    </span>
                  </p>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
    </MarketingShell>
  );
}
