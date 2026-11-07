"use client";
import { useCallback, useEffect, useState } from "react";
import {
  MarketplaceCatalog,
  marketplaceJson,
  marketPrice,
  type MarketplaceProduct,
} from "./marketplace-catalog";
import type { Session } from "./console-types";
import type { GuardianFetch } from "./flows/client";
import { browserApiBase } from "./browser-api";
import { MarketplaceDemo } from "./marketplace-demo";
import { MarketplaceCases } from "./marketplace-cases";
type Item = {
  id: string;
  product: MarketplaceProduct;
  quantity: number;
  paymentState: string;
  fulfillmentState: string;
  shipping?: { carrier: string; tracking: string };
};
type Order = { id: string; items: Item[] };
type Quote = {
  id: string;
  totalMicro: string;
  expiresAt: string;
  items: (MarketplaceProduct & { quantity: number; lineTotalMicro: string })[];
  shippingAndTax?: string;
};
function LiveMarketplaceBuyer({
  session,
  gFetch,
  initialTab,
}: {
  session: Session;
  gFetch: GuardianFetch;
  initialTab: "shop" | "orders";
}) {
  const [agent, setAgent] = useState(session.agentKeys[0]?.agentId ?? ""),
    [shortlist, setShortlist] = useState<MarketplaceProduct[]>([]),
    [orders, setOrders] = useState<Order[]>([]),
    [quote, setQuote] = useState<Quote | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [delivery, setDelivery] = useState(""),
    [error, setError] = useState("");
  const [shippingAddress, setShippingAddress] = useState({
    name: "",
    line1: "",
    city: "",
    postalCode: "",
    country: "",
  });
  const load = useCallback(async () => {
    setOrders((await marketplaceJson(await gFetch("/v1/guardian/marketplace/orders"))).orders);
  }, [gFetch]);
  const caseRequest = useCallback(
    async (method: string, path: string, body?: unknown) =>
      marketplaceJson(
        await gFetch(path, {
          method,
          ...(body !== undefined
            ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
            : {}),
        }),
      ),
    [gFetch],
  );
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [load]);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("product");
    if (!id) return;
    const c = new AbortController();
    fetch(`${browserApiBase()}/v1/marketplace/products/${encodeURIComponent(id)}`, {
      signal: c.signal,
    })
      .then(marketplaceJson)
      .then((v) => setShortlist([v.product]))
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => c.abort();
  }, []);
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      try {
        await load();
      } catch (e) {
        setError(
          (previous) => previous || (e instanceof Error ? e.message : "Order refresh failed"),
        );
      }
      setBusy(false);
    }
  }
  async function agentCall(path: string, body: unknown, method = "POST") {
    const key = session.agentKeys.find((k) => k.agentId === agent)?.key;
    if (!key)
      throw Error(
        "Connect an agent in Agents before preparing checkout. Its credential remains in this tab.",
      );
    return marketplaceJson(
      await fetch(`${browserApiBase()}/v1/agent/marketplace${path}`, {
        method,
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  }
  async function prepare() {
    const cart = await agentCall("/carts", {});
    let revision = cart.revision;
    for (const p of shortlist) {
      const updated = await agentCall(
        `/carts/${cart.id}/items`,
        { productId: p.id, quantity: 1, revision },
        "PUT",
      );
      revision = updated.revision;
    }
    setQuote(
      await agentCall(
        `/carts/${cart.id}/${shortlist.some((p) => p.kind === "physical") ? "shipping-quote" : "quote"}`,
        { shippingAddress },
      ),
    );
    setMessage("Review the items and total. Preparing a quote has not moved money.");
  }
  async function purchase() {
    if (!quote) return;
    const order = await agentCall("/checkout", {
      quoteId: quote.id,
      idempotencyKey: `quote:${quote.id}`,
      shippingAddress,
    });
    setMessage(
      `Order ${order.id} created. If payment is interrupted, recheck this order below instead of creating another checkout.`,
    );
    await load();
    await agentCall(`/orders/${order.id}/pay`, {});
    setQuote(null);
    setShortlist([]);
    setMessage(
      "Payment requested under your agent’s policy. Check each item’s status below; an approval or uncertain result is not a completed purchase.",
    );
  }
  return (
    <div className="market-workspace">
      <h1>Catalog</h1>
      <p>
        Find products, prepare a shortlist and review purchases. Your existing budget and approval
        rules still apply.
      </p>
      {error && (
        <p role="alert" className="market-notice">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {delivery && <pre className="market-delivery">{delivery}</pre>}
      <div hidden={initialTab === "orders"}>
        <MarketplaceCatalog
          onSelect={(p) => {
            setShortlist((items) => (items.some((i) => i.id === p.id) ? items : [...items, p]));
            setQuote(null);
          }}
        />
        <section className="market-shortlist">
          <h2>Your shortlist</h2>
          <label>
            Shopping agent
            <select
              value={agent}
              onChange={(e) => {
                setAgent(e.target.value);
                setQuote(null);
              }}
            >
              <option value="">Choose a connected agent</option>
              {session.agentKeys.map((k) => (
                <option key={k.agentId} value={k.agentId}>
                  {k.name}
                </option>
              ))}
            </select>
          </label>

          {shortlist.length ? (
            <>
              <ul>
                {shortlist.map((p) => (
                  <li key={p.id}>
                    {p.name} · {marketPrice(p.priceMicro)}{" "}
                    <button
                      disabled={busy}
                      onClick={() => {
                        setShortlist((v) => v.filter((i) => i.id !== p.id));
                        setQuote(null);
                      }}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
              {shortlist.some((p) => p.kind === "physical") && (
                <div className="market-form">
                  {[
                    ["name", "Recipient name"],
                    ["line1", "Street address"],
                    ["city", "City"],
                    ["postalCode", "Postal code"],
                    ["country", "Country (two-letter ISO code)"],
                  ].map(([key, label]) => (
                    <label key={key}>
                      {label}
                      <input
                        value={shippingAddress[key as keyof typeof shippingAddress]}
                        maxLength={key === "country" ? 2 : 200}
                        onChange={(e) => {
                          setShippingAddress((v) => ({
                            ...v,
                            [key]:
                              key === "country" ? e.target.value.toUpperCase() : e.target.value,
                          }));
                          setQuote(null);
                        }}
                      />
                    </label>
                  ))}
                </div>
              )}
              <button disabled={busy || !agent} onClick={() => void act(prepare)}>
                Prepare a quote
              </button>
            </>
          ) : (
            <p>Add products from the catalog to compare a purchase before any payment.</p>
          )}
          {quote && (
            <div className="market-review">
              <h3>Review purchase</h3>
              <ul>
                {quote.items.map((i) => (
                  <li key={i.id}>
                    <strong>{i.name}</strong> · {i.quantity} × {marketPrice(i.priceMicro)} · line
                    total {marketPrice(i.lineTotalMicro)} · seller {i.sellerName ?? i.vendorId}
                  </li>
                ))}
              </ul>
              <p>
                {quote.items.length} items · <strong>{marketPrice(quote.totalMicro)}</strong>
              </p>
              <p>
                Quote expires {new Date(quote.expiresAt).toLocaleTimeString()}.{" "}
                {quote.shippingAndTax}
              </p>
              <button
                disabled={busy || Date.parse(quote.expiresAt) < Date.now()}
                onClick={() => void act(purchase)}
              >
                Confirm and request payment
              </button>
              <button disabled={busy} onClick={() => setQuote(null)}>
                Keep browsing
              </button>
            </div>
          )}
        </section>
      </div>
      <section>
        <div className="market-section-heading">
          <h2>Your orders</h2>
          <button disabled={busy} onClick={() => void act(load)}>
            Refresh order status
          </button>
        </div>
        {orders.length ? (
          orders.map((o) => (
            <article key={o.id} className="market-order">
              <h3>Order {o.id.slice(-8)}</h3>
              {o.items.map((i) => (
                <div key={i.id} className="market-order-item">
                  <div>
                    <strong>{i.product.name}</strong>
                    <p>
                      Payment: {i.paymentState} · Delivery: {i.fulfillmentState}
                    </p>
                    {i.shipping && (
                      <p>
                        {i.shipping.carrier} · {i.shipping.tracking}
                      </p>
                    )}
                  </div>
                  <div className="market-actions">
                    {["unpaid", "unknown", "awaiting_approval", "paying"].includes(
                      i.paymentState,
                    ) && (
                      <button
                        disabled={busy || !agent}
                        onClick={() =>
                          void act(async () => {
                            await agentCall(`/orders/${o.id}/pay`, {});
                          })
                        }
                      >
                        Recheck governed payment
                      </button>
                    )}
                    {i.paymentState === "unpaid" && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          void act(async () => {
                            await agentCall(`/orders/${o.id}/cancel`, {});
                          })
                        }
                      >
                        Cancel unpaid items
                      </button>
                    )}
                    {i.fulfillmentState === "shipped" && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          void act(async () => {
                            await marketplaceJson(
                              await gFetch(`/v1/guardian/marketplace/items/${i.id}/confirm`, {
                                method: "POST",
                                headers: { "content-type": "application/json" },
                                body: "{}",
                              }),
                            );
                          })
                        }
                      >
                        Confirm received
                      </button>
                    )}
                    {i.product.kind === "digital" &&
                      i.paymentState === "paid" &&
                      i.fulfillmentState === "delivered" && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            void act(async () => {
                              const data = await marketplaceJson(
                                await gFetch(`/v1/guardian/marketplace/items/${i.id}/delivery`),
                              );
                              setDelivery(
                                typeof data.content === "string"
                                  ? data.content
                                  : JSON.stringify(data.content, null, 2),
                              );
                            })
                          }
                        >
                          Retrieve digital delivery
                        </button>
                      )}
                  </div>
                  <MarketplaceItemFeedback item={i} gFetch={gFetch} />
                </div>
              ))}
            </article>
          ))
        ) : (
          <p>No orders yet. Your purchases will stay here across sessions.</p>
        )}
      </section>
      <MarketplaceCases request={caseRequest} />
    </div>
  );
}

function MarketplaceItemFeedback({ item, gFetch }: { item: Item; gFetch: GuardianFetch }) {
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  if (!["paid", "escrowed"].includes(item.paymentState)) return null;
  const submit = async (path: string, body: unknown) => {
    setBusy(true);
    try {
      await marketplaceJson(
        await gFetch(`/v1/guardian/marketplace/items/${item.id}/${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
      setMessage("Saved. The record stays linked to this purchase.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="market-feedback">
      <summary>Review or get help with this item</summary>
      {message && <p role="status">{message}</p>}
      {item.fulfillmentState === "delivered" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const d = new FormData(e.currentTarget);
            void submit("review", { score: Number(d.get("score")), body: d.get("body") });
          }}
        >
          <label>
            Purchase rating
            <select name="score">
              <option value="5">5 / 5</option>
              <option value="4">4 / 5</option>
              <option value="3">3 / 5</option>
              <option value="2">2 / 5</option>
              <option value="1">1 / 5</option>
            </select>
          </label>
          <label>
            Your review
            <textarea name="body" required maxLength={2000} />
          </label>
          <button disabled={busy}>Save human review</button>
        </form>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          void submit("cases", { kind: d.get("kind"), reason: d.get("reason") });
        }}
      >
        <label>
          Help needed
          <select name="kind">
            <option value="dispute">Open a dispute</option>
            <option value="return">Request a return</option>
          </select>
        </label>
        <label>
          What happened?
          <textarea name="reason" required maxLength={2000} />
        </label>
        <button disabled={busy}>Open a case</button>
      </form>
    </details>
  );
}

export function MarketplaceBuyer({
  session,
  gFetch,
  initialTab = "shop",
}: {
  session: Session;
  gFetch: GuardianFetch;
  initialTab?: "shop" | "orders";
}) {
  const [mode, setMode] = useState<"demo" | "live">("live");
  useEffect(() => {
    if (initialTab === "orders") setMode("live");
  }, [initialTab]);
  return (
    <div className="studio-marketplace">
      <div className="market-mode" role="group" aria-label="Marketplace mode">
        <button aria-pressed={mode === "demo"} onClick={() => setMode("demo")}>
          Demo marketplace
        </button>
        <button aria-pressed={mode === "live"} onClick={() => setMode("live")}>
          Live listings & orders
        </button>
      </div>
      {mode === "demo" ? (
        <MarketplaceDemo />
      ) : (
        <LiveMarketplaceBuyer session={session} gFetch={gFetch} initialTab={initialTab} />
      )}
    </div>
  );
}
