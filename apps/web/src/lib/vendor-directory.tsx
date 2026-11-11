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

function Monogram({ provider, large }: { provider: IntegratedProvider; large?: boolean }) {
  return (
    <span className={`vendor-monogram${large ? " is-large" : ""}`} aria-hidden="true">
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

function CardBody({ provider }: { provider: IntegratedProvider }) {
  return (
    <>
      <span className="vendor-card-top">
        <Monogram provider={provider} />
        <span className="vendor-card-title">
          <strong>{provider.name}</strong>
          <span>
            {provider.kindLabel} · {provider.actions.length} {provider.actionNoun}
          </span>
        </span>
        <Icon name="arrowRight" size={18} />
      </span>
      <span className="vendor-card-tagline">{provider.tagline}</span>
      <span className="vendor-card-foot">
        <span className="vendor-card-price">{provider.pricingSummary}</span>
        <span className="vendor-status-pill">{provider.status.label}</span>
      </span>
    </>
  );
}

/**
 * Integrated vendor cards. Filters with the catalog's own search text and kind
 * tab. Public pages link to /providers/[slug]; the logged-in Marketplace opens
 * the detail in place so the buyer stays in the app.
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
      <div className="vendor-dir-heading">
        <h3 id="vendor-dir-title">Integrated providers</h3>
        <p>
          Real vendors with published prices. Open one to see each product or tool and what it
          costs.
        </p>
      </div>
      <ul className="vendor-grid">
        {providers.map((provider) => (
          <li key={provider.slug}>
            {inline ? (
              <button
                type="button"
                className="vendor-card"
                onClick={() => setOpen(provider.slug)}
                aria-label={`${provider.name}, ${provider.actions.length} ${provider.actionNoun}`}
              >
                <CardBody provider={provider} />
              </button>
            ) : (
              <Link className="vendor-card" href={`/providers/${provider.slug}`}>
                <CardBody provider={provider} />
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
  const [filter, setFilter] = useState("");
  const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
  const actions = provider.actions.filter((a) =>
    words.every((w) =>
      [a.name, a.description, a.reference, a.price].join(" ").toLowerCase().includes(w),
    ),
  );
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
        <Monogram provider={provider} large />
        <div>
          <h2>{provider.name}</h2>
          <p className="vendor-detail-meta">
            {provider.kindLabel} · {provider.categories.join(" · ")} ·{" "}
            <a href={provider.website} target="_blank" rel="noopener noreferrer">
              {provider.website.replace(/^https:\/\/(www\.)?/, "")}
            </a>
          </p>
          <p>{provider.description}</p>
        </div>
      </header>
      <div className="vendor-status" role="note">
        <strong>{provider.status.label}.</strong> {provider.status.detail}
      </div>
      <div className="vendor-actions-head">
        <h3>
          {provider.actions.length} {provider.actionNoun}
        </h3>
        <label className="sr-only" htmlFor={`vendor-filter-${provider.slug}`}>
          Filter {provider.actionNoun}
        </label>
        <input
          id={`vendor-filter-${provider.slug}`}
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={`Filter ${provider.actionNoun}`}
        />
      </div>
      <p className="vendor-pricing-note">{provider.pricingNote}</p>
      <ul className="vendor-actions">
        {actions.map((action) => (
          <li key={action.id} className="vendor-action">
            <div className="vendor-action-main">
              <h4>{action.name}</h4>
              <p>{action.description}</p>
              <code>{action.reference}</code>
              {action.facts.length > 0 && (
                <ul className="vendor-facts">
                  {action.facts.map((fact) => (
                    <li key={fact}>{fact}</li>
                  ))}
                </ul>
              )}
              {action.examples && (
                <p className="vendor-examples">Example SKUs: {action.examples.join(", ")}</p>
              )}
            </div>
            <div className="vendor-action-price">
              <strong>{action.price}</strong>
              <span>{action.priceDetail}</span>
              <button type="button" disabled title={provider.status.detail}>
                Not available yet
              </button>
            </div>
          </li>
        ))}
        {actions.length === 0 && (
          <li className="vendor-action-empty">No {provider.actionNoun} match that filter.</li>
        )}
      </ul>
      <footer className="vendor-sources">
        <p>Prices checked on {verifiedLabel} from the vendor&apos;s own pages:</p>
        <ul>
          {provider.sources.map((s) => (
            <li key={s.url}>
              <a href={s.url} target="_blank" rel="noopener noreferrer">
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      </footer>
    </article>
  );
}
