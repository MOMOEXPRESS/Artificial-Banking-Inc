"use client";
import Link from "next/link";
import { useState } from "react";
import { Icon } from "./ui";
import {
  INTEGRATED_PROVIDERS,
  VERIFIED_ON,
  matchProviders,
  type IntegratedProvider,
} from "./vendor-directory-data";
import "./vendor-directory.css";

const verifiedLabel = new Date(`${VERIFIED_ON}T12:00:00Z`).toLocaleDateString("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

function Logo({ provider, large }: { provider: IntegratedProvider; large?: boolean }) {
  return (
    <span className={`vendor-logo${large ? " is-large" : ""}`} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element -- tiny static vendor mark */}
      <img
        src={provider.logo.src}
        alt=""
        width={provider.logo.width}
        height={provider.logo.height}
      />
    </span>
  );
}

function RowBody({ provider }: { provider: IntegratedProvider }) {
  return (
    <>
      <Logo provider={provider} />
      <span className="vendor-row-text">
        <strong>{provider.name}</strong>
        <small>
          {provider.actions.length} {provider.actionNoun} · {provider.pricingSummary}
        </small>
      </span>
      <Icon name="arrowRight" size={18} />
    </>
  );
}

/**
 * Integrated vendors as a provider list (logo, name, action count, starting
 * price). Filters with the catalog's own search text and kind tab. Public pages
 * link to /providers/[slug]; the logged-in Marketplace opens the detail in place
 * so the buyer stays in the app.
 */
export function ProviderDirectory({
  query = "",
  kind = "",
  inline = false,
}: {
  query?: string;
  kind?: string;
  inline?: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const providers = matchProviders(query, kind);
  const selected = open ? INTEGRATED_PROVIDERS.find((p) => p.slug === open) : undefined;
  if (selected)
    return (
      <div className="vendor-dir">
        <ProviderDetail provider={selected} onBack={() => setOpen(null)} />
      </div>
    );
  if (providers.length === 0) return null;
  return (
    <section className="vendor-dir" aria-labelledby="vendor-dir-title">
      <h3 id="vendor-dir-title" className="vendor-dir-title">
        Providers
      </h3>
      <ul className="vendor-list">
        {providers.map((provider) => (
          <li key={provider.slug}>
            {inline ? (
              <button
                type="button"
                className="vendor-row"
                onClick={() => setOpen(provider.slug)}
                aria-label={`${provider.name}, ${provider.actions.length} ${provider.actionNoun}`}
              >
                <RowBody provider={provider} />
              </button>
            ) : (
              <Link className="vendor-row" href={`/providers/${provider.slug}`}>
                <RowBody provider={provider} />
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ProviderDetail({
  provider,
  onBack,
}: {
  provider: IntegratedProvider;
  onBack?: () => void;
}) {
  return (
    <article className="vendor-detail">
      {onBack ? (
        <button type="button" className="vendor-back" onClick={onBack}>
          ← All providers
        </button>
      ) : (
        <Link className="vendor-back" href="/directory">
          ← All providers
        </Link>
      )}
      <header className="vendor-detail-head">
        <Logo provider={provider} large />
        <div>
          <h2>{provider.name}</h2>
          <p>{provider.tagline}</p>
        </div>
        <span className="vendor-status-pill" title={provider.status.detail}>
          {provider.status.label}
        </span>
      </header>
      <h3 className="vendor-actions-title">
        {provider.actions.length} {provider.actionNoun}
      </h3>
      <ul className="vendor-actions">
        {provider.actions.map((action) => (
          <li key={action.id} className="vendor-action">
            <span className="vendor-action-name">{action.name}</span>
            <span className="vendor-action-price">
              <strong>{action.unitPrice}</strong>
              {action.unitNote && <small>{action.unitNote}</small>}
            </span>
          </li>
        ))}
      </ul>
      <footer className="vendor-sources">
        <p>
          {provider.pricingNote} {provider.status.detail}
        </p>
        <p>
          Checked {verifiedLabel} on{" "}
          {provider.sources.map((s, i) => (
            <span key={s.url}>
              {i > 0 && ", "}
              <a href={s.url} target="_blank" rel="noopener noreferrer">
                {s.label}
              </a>
            </span>
          ))}
          .
        </p>
      </footer>
    </article>
  );
}
