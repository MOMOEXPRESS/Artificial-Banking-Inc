"use client";
import { useCallback, useEffect, useState } from "react";
import { sellerApiFetch } from "./seller-api";
import { marketplaceJson, marketPrice, type MarketplaceProduct } from "./marketplace-catalog";
import { MarketplaceCases } from "./marketplace-cases";
import dynamic from "next/dynamic";
const SellerListingEditor = dynamic(
  () => import("./seller-listing-editor").then((m) => m.SellerListingEditor),
  { loading: () => <p role="status">Opening listing editor…</p> },
);
type Inventory = MarketplaceProduct & { state: string; offerId?: string };
type SellerItem = {
  id: string;
  quantity: number;
  product: MarketplaceProduct;
  paymentState: string;
  fulfillmentState: string;
};
export function MarketplaceSeller({
  offers,
  initialPanel = "products",
  onPanelChange,
}: {
  offers: { id: string; title: string }[];
  initialPanel?: string;
  onPanelChange?: (panel: string) => void;
}) {
  const [panel, setPanel] = useState(initialPanel);
  useEffect(() => setPanel(initialPanel), [initialPanel]);
  function selectPanel(next: string) {
    setPanel(next);
    onPanelChange?.(next);
  }
  const [editorOpen, setEditorOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<Inventory[]>([]),
    [items, setItems] = useState<SellerItem[]>([]),
    [vendor, setVendor] = useState("unverified"),
    [editing, setEditing] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const call = useCallback(
    async (path: string, body?: unknown, method = "POST") =>
      marketplaceJson(
        await sellerApiFetch(`/v1/seller/marketplace${path}`, {
          method: body === undefined ? "GET" : method,
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        }),
      ),
    [],
  );
  const load = useCallback(async () => {
    const [p, v, o] = await Promise.all([call("/products"), call("/vendor"), call("/orders")]);
    setProducts(p.products);
    setVendor(v.status);
    setItems(o.items);
  }, [call]);
  const caseRequest = useCallback(
    async (method: string, path: string, body?: unknown) =>
      marketplaceJson(
        await sellerApiFetch(path, {
          method,
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        }),
      ),
    [],
  );
  useEffect(() => {
    void load()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [load]);
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }
  function edit(p: Inventory) {
    setEditing(p.id);
    setEditorOpen(true);
  }
  if (editorOpen)
    return (
      <section className="market-workspace">
        <SellerListingEditor
          key={editing ?? "new"}
          product={products.find((p) => p.id === editing)}
          offers={offers}
          onClose={() => {
            setEditorOpen(false);
            setEditing(null);
          }}
          onSave={async (payload) => {
            await call(
              `/products${editing ? `/${editing}` : ""}`,
              payload,
              editing ? "PUT" : "POST",
            );
            setEditorOpen(false);
            setEditing(null);
            setNotice(
              "Listing saved as a draft. Review the listing and payment offer before publishing.",
            );
            await load().catch((e) => setError(e.message));
          }}
        />
      </section>
    );
  return (
    <section className="market-workspace">
      <div className="studio-inventory-heading">
        <div>
          <h2>Your products, ready for agents.</h2>
          <p>Manage listings, availability and fulfillment in one workspace.</p>
        </div>
        <button
          disabled={editorOpen}
          onClick={() => {
            setEditing(null);
            setEditorOpen(true);
            selectPanel("products");
          }}
        >
          Add listing
        </button>
      </div>
      <nav className="studio-section-tabs" aria-label="Seller marketplace sections">
        {[
          ["products", `Products (${products.length})`],
          ["orders", `Order items (${items.length})`],
          ["cases", "Returns & disputes"],
          ["identity", "Vendor identity"],
        ].map(([id, label]) => (
          <button key={id} aria-pressed={panel === id} onClick={() => selectPanel(id)}>
            {label}
          </button>
        ))}
      </nav>
      {loading && <p role="status">Loading your inventory and order items…</p>}
      <p>
        Products, variants and stock are separate from their payment offers. All changes return a
        product to draft for review.
      </p>
      {error && (
        <p role="alert" className="market-notice">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <div hidden={panel !== "identity"}>
        <details className="market-onboarding" open={vendor === "unverified"}>
          <summary>Vendor identity · {vendor}</summary>
          <p>
            Identity review and a payout wallet are required before publication. Endpoint ownership
            alone does not verify your business.
          </p>
          <form
            className="market-form"
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              void act(async () => {
                await call("/vendor", Object.fromEntries(data), "PUT");
                setNotice("Identity submitted for reviewer assessment.");
              });
            }}
          >
            {[
              ["legalName", "Legal name"],
              ["country", "Country (ISO code)"],
              ["registration", "Business registration or identity review reference"],
              ["contact", "Contact email"],
            ].map(([name, label]) => (
              <label key={name}>
                {label}
                <input name={name} required maxLength={name === "country" ? 2 : 200} />
              </label>
            ))}
            <button disabled={busy}>Submit for review</button>
          </form>
        </details>
      </div>
      <div hidden={panel !== "products"}>
        <div className="market-table-wrap">
          <table>
            <caption>Your listings and publication status</caption>
            <thead>
              <tr>
                <th>Name</th>
                <th>Price</th>
                <th>Stock</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{marketPrice(p.priceMicro)}</td>
                  <td>{p.stockLevel}</td>
                  <td>
                    <span className="pill">{p.state}</span>
                  </td>
                  <td>
                    <button disabled={busy} onClick={() => edit(p)}>
                      Edit
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          await call(`/products/${p.id}/publish`, {
                            published: p.state !== "published",
                          });
                        })
                      }
                    >
                      {p.state === "published" ? "Unpublish" : "Publish"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!products.length && <p>No listings yet. Add a draft above.</p>}
        </div>
      </div>
      <div hidden={panel !== "orders"}>
        {" "}
        <h3>Marketplace order items</h3>
        {items.length ? (
          items.map((i) => (
            <div key={i.id} className="market-order-item">
              <div>
                <strong>
                  {i.quantity} × {i.product.name}
                </strong>
                <p>
                  {i.paymentState} · {i.fulfillmentState}
                </p>
              </div>
              {i.product.kind === "physical" &&
                i.paymentState === "escrowed" &&
                i.fulfillmentState === "pending" && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        await call(`/items/${i.id}/label`, {});
                      })
                    }
                  >
                    Create shipping label
                  </button>
                )}
              {i.product.kind === "service" &&
                i.paymentState === "paid" &&
                i.fulfillmentState === "pending" && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        await call(`/items/${i.id}/fulfill`, { state: "delivered" });
                      })
                    }
                  >
                    Mark service delivered
                  </button>
                )}
            </div>
          ))
        ) : (
          <p>No marketplace orders yet.</p>
        )}
      </div>
      <div hidden={panel !== "cases"}>
        <MarketplaceCases seller request={caseRequest} />
      </div>
    </section>
  );
}
