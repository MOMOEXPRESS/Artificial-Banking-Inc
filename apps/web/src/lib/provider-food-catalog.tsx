"use client";
import { useState } from "react";
import { ArrowLeft, ArrowRight, ExternalLink, Search } from "lucide-react";
import { MarketplaceImage } from "./marketplace-image";
import type { IntegratedProvider } from "./vendor-directory-data";
/** A display catalogue: products are never mapped to a live cart, price or stock value. */
export function ProviderFoodCatalog({ provider }: { provider: IntegratedProvider }) {
  const [category, setCategory] = useState(""),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(0);
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const products = provider.actions.filter(
    (p) =>
      (!category || p.categories?.includes(category)) &&
      words.every((w) =>
        [p.name, p.reference, p.brand, ...(p.categories ?? [])].join(" ").toLowerCase().includes(w),
      ),
  );
  const pageSize = 24,
    pages = Math.max(1, Math.ceil(products.length / pageSize));
  const choose = (value: string) => {
    setCategory(value);
    setPage(0);
  };
  return (
    <div className="abi-food-catalog">
      <aside className="abi-food-categories" aria-label="Food categories">
        <h3>Shop by category</h3>
        <label className="abi-food-mobile-category">
          Category
          <select
            aria-label="Food category"
            value={category}
            onChange={(e) => choose(e.target.value)}
          >
            <option value="">All products ({provider.actions.length})</option>
            {provider.categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <nav aria-label="RH Amar categories">
          <button
            type="button"
            aria-current={!category ? "true" : undefined}
            onClick={() => choose("")}
          >
            <span>All products</span>
            <small>{provider.actions.length}</small>
          </button>
          {provider.categories.map((c) => {
            const items = provider.actions.filter((p) => p.categories?.includes(c));
            return (
              <button
                type="button"
                key={c}
                aria-current={category === c ? "true" : undefined}
                onClick={() => choose(c)}
              >
                {items[0]?.image && <MarketplaceImage src={items[0].image} alt="" />}
                <span>{c}</span>
                <small>{items.length}</small>
              </button>
            );
          })}
        </nav>
      </aside>
      <section className="abi-food-results" aria-label="RH Amar products">
        <div className="abi-food-toolbar">
          <div>
            <h3>{category || "All products"}</h3>
            <p role="status">
              {products.length.toLocaleString()} {products.length === 1 ? "product" : "products"}
            </p>
          </div>
          <label className="abi-food-search">
            <Search size={17} />
            <input
              aria-label="Search RH Amar products"
              placeholder="Search products or brands"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
            />
          </label>
        </div>
        {products.length ? (
          <ul className="abi-food-grid">
            {products.slice(page * pageSize, (page + 1) * pageSize).map((p) => (
              <li key={p.id} id={p.id}>
                <div className="abi-food-product-image">
                  <MarketplaceImage src={p.image ?? ""} alt={p.name} />
                </div>
                <div className="abi-food-product-copy">
                  <p>{p.brand}</p>
                  <h4>{p.name}</h4>
                  <small>SKU {p.reference}</small>
                  <a href={p.sourceUrl} target="_blank" rel="noreferrer">
                    View at RH Amar <ExternalLink size={13} />
                  </a>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="abi-food-empty">
            No products match this search. Try a brand, product name or another category.
          </p>
        )}
        {pages > 1 && (
          <nav className="abi-food-pagination" aria-label="Product pages">
            <button type="button" disabled={!page} onClick={() => setPage((p) => p - 1)}>
              <ArrowLeft size={16} />
              Previous
            </button>
            <span>
              Page {page + 1} of {pages}
            </span>
            <button
              type="button"
              disabled={page + 1 >= pages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
              <ArrowRight size={16} />
            </button>
          </nav>
        )}
      </section>
    </div>
  );
}
