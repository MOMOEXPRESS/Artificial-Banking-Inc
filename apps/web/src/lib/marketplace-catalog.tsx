"use client";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { Icon } from "./ui";
import { browserApiBase } from "./browser-api";
import { ProviderDirectory } from "./vendor-directory";
import { matchProviders } from "./vendor-directory-data";
export type MarketplaceProduct = {
  id: string;
  vendorId: string;
  sellerName?: string;
  name: string;
  description: string;
  category: string;
  priceMicro: string;
  currency: string;
  stockLevel: number;
  images: string[];
  kind: string;
  attributes: Record<string, unknown>;
  trust?: {
    humanReviews: { count: number; average: number | null };
    agentSignals: { count: number; average: number | null };
  };
};
export const marketPrice = (value: string) => {
  try {
    const n = BigInt(value);
    return `${n / 1000000n}.${(n % 1000000n).toString().padStart(6, "0").replace(/0+$/, "") || "00"} USDC`;
  } catch {
    return "Price unavailable";
  }
};
const API = browserApiBase();
export async function marketplaceJson(response: Response) {
  const value = await response.json();
  if (!response.ok)
    throw Error(value.error?.message ?? "The marketplace is unavailable. Please try again.");
  return value;
}
export function MarketplaceCatalog({
  compact = false,
  onSelect,
}: {
  compact?: boolean;
  onSelect?: (product: MarketplaceProduct) => void;
}) {
  const [query, setQuery] = useState(""),
    [submitted, setSubmitted] = useState(""),
    [kind, setKind] = useState(""),
    [color, setColor] = useState(""),
    [region, setRegion] = useState(""),
    [inStock, setInStock] = useState(false),
    [page, setPage] = useState(0);
  const [mode, setMode] = useState(compact ? "products" : "providers"),
    [vendor, setVendor] = useState(""),
    [category, setCategory] = useState("");
  const [providers, setProviders] = useState<
      { id: string; name: string; count: number; kinds: string[] }[]
    >([]),
    [providerTotal, setProviderTotal] = useState(0),
    [categories, setCategories] = useState<{ name: string; count: number }[]>([]);
  const [products, setProducts] = useState<MarketplaceProduct[]>([]),
    [total, setTotal] = useState(0),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    const params = new URLSearchParams(window.location.search),
      q = params.get("q"),
      type = params.get("kind");
    if (q) {
      setQuery(q);
      setSubmitted(q);
    }
    if (type && ["digital", "physical", "service"].includes(type)) setKind(type);
  }, []);
  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    setError("");
    const q = new URLSearchParams({
      q: submitted,
      limit: compact ? "4" : "12",
      offset: String(page * 12),
    });
    if (kind) q.set("kind", kind);
    if (vendor) q.set("vendorId", vendor);
    if (category) q.set("category", category);
    if (color) q.set("color", color);
    if (region) q.set("region", region);
    if (inStock) q.set("inStock", "true");
    fetch(`${API}/v1/marketplace/products?${q}`, { signal: c.signal })
      .then(marketplaceJson)
      .then((v) => {
        setProducts(v.products);
        setProviders(v.providers ?? []);
        setProviderTotal(v.totalProviders ?? 0);
        setCategories(v.categories ?? []);
        setTotal(v.total);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [submitted, kind, color, region, inStock, page, compact, vendor, category]);
  function search(e: FormEvent) {
    e.preventDefault();
    setPage(0);
    setSubmitted(query);
  }
  return (
    <section
      className={compact ? "market-catalog" : "market-catalog reference-catalog"}
      aria-label="Marketplace products"
    >
      <div className="market-section-heading">
        <div>
          <h2>{compact ? "Explore the marketplace" : "Browse products and services"}</h2>
          <p>
            Live seller listings. Stock is reserved at checkout; feedback comes from actual
            purchases.
          </p>
        </div>
        {compact && <Link href="/directory">View all products</Link>}
      </div>
      {!compact && (
        <>
          <h2 className="reference-catalog-title">
            {loading || total === 0
              ? "Explore the marketplace"
              : `${total.toLocaleString()} listings for your agents`}
          </h2>
          <div
            className="minimal-tabs reference-catalog-switch"
            role="group"
            aria-label="Browse marketplace"
          >
            <button
              aria-pressed={mode === "providers"}
              onClick={() => {
                setMode("providers");
                setVendor("");
                setPage(0);
              }}
            >
              Providers
            </button>
            <button
              aria-pressed={mode === "products"}
              onClick={() => {
                setMode("products");
                setPage(0);
              }}
            >
              Tools & products
            </button>
          </div>
          {vendor && (
            <button
              className="reference-vendor-back"
              onClick={() => {
                setVendor("");
                setMode("providers");
                setPage(0);
              }}
            >
              All providers
            </button>
          )}
        </>
      )}
      <form className="market-search" onSubmit={search}>
        <label className="sr-only" htmlFor={compact ? "home-product-search" : "product-search"}>
          Describe what you need
        </label>
        <input
          id={compact ? "home-product-search" : "product-search"}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search a provider, product, or what you need"
          type="search"
        />
        <button type="submit" aria-label={compact ? undefined : "Search marketplace"}>
          {compact ? "Find products" : <Icon name="search" size={19} />}
        </button>
      </form>
      <div className="minimal-kind-tabs" role="group" aria-label="Catalog categories">
        {[
          ["", "All"],
          ["service", "Tools & APIs"],
          ["digital", "Software"],
          ["physical", "Physical goods"],
        ].map(([v, l]) => (
          <button
            key={v}
            aria-pressed={kind === v}
            onClick={() => {
              setKind(v);
              setPage(0);
            }}
          >
            {l}
          </button>
        ))}
      </div>
      {!compact && categories.length > 1 && (
        <div className="reference-category-tabs" role="group" aria-label="Product categories">
          {[{ name: "", count: categories.reduce((n, c) => n + c.count, 0) }, ...categories].map(
            (c) => (
              <button
                key={c.name}
                aria-pressed={category === c.name}
                onClick={() => {
                  setCategory(c.name);
                  setPage(0);
                }}
              >
                {c.name || "All categories"}
                <span>{c.count}</span>
              </button>
            ),
          )}
        </div>
      )}
      {!compact && (
        <details className="minimal-filter-disclosure">
          <summary>More filters</summary>
          <div className="market-filters">
            {" "}
            {!compact && (
              <>
                <label>
                  Color
                  <input
                    value={color}
                    onChange={(e) => {
                      setColor(e.target.value);
                      setPage(0);
                    }}
                    placeholder="green"
                  />
                </label>
                <label>
                  Region
                  <input
                    value={region}
                    onChange={(e) => {
                      setRegion(e.target.value);
                      setPage(0);
                    }}
                    placeholder="EU"
                  />
                </label>
                <label className="market-checkbox">
                  <input
                    type="checkbox"
                    checked={inStock}
                    onChange={(e) => {
                      setInStock(e.target.checked);
                      setPage(0);
                    }}
                  />
                  In stock only
                </label>
              </>
            )}
          </div>
        </details>
      )}
      {!vendor && (
        <ProviderDirectory query={submitted.trim()} kind={kind} inline={Boolean(onSelect)} />
      )}
      <p role="status" aria-live="polite">
        {loading
          ? "Checking current listings…"
          : `${total} seller ${total === 1 ? "listing" : "listings"} found`}
      </p>
      {error ? (
        <div role="alert" className="market-notice">
          <p>{error}</p>
          <button onClick={() => setSubmitted(`${submitted} `)}>Try again</button>
        </div>
      ) : !loading && products.length === 0 ? (
        <div className="market-empty">
          <h3>
            {submitted
              ? "No matching seller listings yet"
              : matchProviders("", kind).length
                ? "No seller listings yet"
                : "The marketplace is taking shape"}
          </h3>
          <p>
            {submitted
              ? "Try a broader search or remove a filter."
              : "Reviewed sellers’ published products will appear here. The catalog won’t show pretend inventory."}
          </p>
          <Link href="/partners/login?mode=signup">Become a seller</Link>
        </div>
      ) : mode === "providers" && !compact ? (
        <div className="reference-provider-list">
          {providers.length ? (
            providers.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  setVendor(p.id);
                  setMode("products");
                  setPage(0);
                }}
              >
                <span className="reference-provider-mark">
                  <Icon name={p.kinds.includes("service") ? "zap" : "layers"} size={24} />
                </span>
                <span>
                  <strong>{p.name}</strong>
                  <small>
                    {p.count} {p.count === 1 ? "listing" : "listings"}
                  </small>
                </span>
                <Icon name="arrowRight" size={18} />
              </button>
            ))
          ) : (
            <p>No published providers match these filters.</p>
          )}
        </div>
      ) : (
        <div className="market-product-grid">
          {products.map((p) => (
            <article key={p.id} className="market-product">
              <Link className="market-product-image" href={`/products/${encodeURIComponent(p.id)}`}>
                {p.images.length ? (
                  <img
                    src={`${API}/v1/marketplace/products/${encodeURIComponent(p.id)}/images/0`}
                    alt={p.name}
                    loading="lazy"
                    width="600"
                    height="450"
                  />
                ) : (
                  <span>Image not supplied</span>
                )}
              </Link>
              <div className="market-product-copy">
                <p>
                  {p.category} · {p.kind}
                </p>
                <p>Seller: {p.sellerName ?? p.vendorId}</p>
                <h3>
                  <Link href={`/products/${encodeURIComponent(p.id)}`}>{p.name}</Link>
                </h3>
                <strong>{marketPrice(p.priceMicro)}</strong>
                <p>{p.stockLevel > 0 ? `${p.stockLevel} available` : "Out of stock"}</p>
                <p>
                  {p.trust?.humanReviews.count
                    ? `${p.trust.humanReviews.average?.toFixed(1)} / 5 · ${p.trust.humanReviews.count} reviews`
                    : "No purchase reviews yet"}
                </p>
                {onSelect && (
                  <button disabled={!p.stockLevel} onClick={() => onSelect(p)}>
                    Add to shortlist
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      {!compact && (mode === "providers" ? providerTotal : total) > 12 && (
        <nav className="market-pagination" aria-label="Product pages">
          <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            Previous
          </button>
          <span>Page {page + 1}</span>
          <button
            disabled={(page + 1) * 12 >= (mode === "providers" ? providerTotal : total)}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </nav>
      )}
    </section>
  );
}
type Detail = {
  product: MarketplaceProduct;
  appearance: { colors: string[]; sizes: string[] };
  delivery: { regions: string[]; estimatedDays: number | null };
  quality: {
    humanReviews: { count: number; average: number | null };
    agentSignals: { count: number; average: number | null };
  };
};
export function MarketplaceProductDetail({ id }: { id: string }) {
  const [value, setValue] = useState<Detail | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    const c = new AbortController();
    fetch(`${API}/v1/marketplace/products/${encodeURIComponent(id)}`, { signal: c.signal })
      .then(marketplaceJson)
      .then(setValue)
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => c.abort();
  }, [id]);
  if (error)
    return (
      <div role="alert" className="market-empty">
        <h1>Product unavailable</h1>
        <p>{error}</p>
        <Link href="/directory">Back to products</Link>
      </div>
    );
  if (!value) return <p role="status">Checking product details and stock…</p>;
  const p = value.product;
  return (
    <section className="market-detail">
      <div className="market-detail-images">
        {p.images.length ? (
          p.images.map((_image, i) => (
            <img
              key={i}
              src={`${API}/v1/marketplace/products/${encodeURIComponent(id)}/images/${i}`}
              alt={`${p.name}, view ${i + 1}`}
              width="800"
              height="600"
              loading={i ? "lazy" : "eager"}
            />
          ))
        ) : (
          <p>The seller hasn’t supplied an image.</p>
        )}
      </div>
      <div>
        <Link href="/directory">Back to products</Link>
        <h1>{p.name}</h1>
        <p>{p.description}</p>
        <p className="market-price">{marketPrice(p.priceMicro)}</p>
        <dl>
          <dt>Seller</dt>
          <dd>{p.sellerName ?? p.vendorId}</dd>
          <dt>Stock</dt>
          <dd>{p.stockLevel} available · reservation required</dd>
          <dt>Colors</dt>
          <dd>{value.appearance.colors.join(", ") || "Not supplied"}</dd>
          <dt>Sizes</dt>
          <dd>{value.appearance.sizes.join(", ") || "Not supplied"}</dd>
          <dt>Delivery region</dt>
          <dd>{value.delivery.regions.join(", ") || "Confirm with seller"}</dd>
          <dt>Seller delivery estimate</dt>
          <dd>
            {value.delivery.estimatedDays === null
              ? "Not supplied"
              : `${value.delivery.estimatedDays} days`}
          </dd>
          <dt>Human purchase reviews</dt>
          <dd>
            {value.quality.humanReviews.count
              ? `${value.quality.humanReviews.average} / 5 (${value.quality.humanReviews.count})`
              : "No reviews yet"}
          </dd>
          <dt>Agent quality signals</dt>
          <dd>
            {value.quality.agentSignals.count
              ? `${value.quality.agentSignals.average} / 5 (${value.quality.agentSignals.count})`
              : "No signals yet"}
          </dd>
        </dl>
        <p>
          Descriptions, appearance and estimates are seller-provided. Purchase feedback is recorded
          separately.
        </p>
        <Link
          className="market-button"
          href={`/console?view=marketplace&product=${encodeURIComponent(id)}`}
        >
          Shop with your agent
        </Link>
        <p className="market-fine">
          Physical checkout requires configured shipping and cross-vendor escrow providers.
          Availability is checked again before reservation.
        </p>
      </div>
    </section>
  );
}
