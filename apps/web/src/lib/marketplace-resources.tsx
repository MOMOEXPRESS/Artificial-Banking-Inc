"use client";

import { useEffect, useState } from "react";
import { Icon } from "./ui";
import { marketplaceJson } from "./marketplace-catalog";
import {
  purchasedResources,
  resourceReady,
  type ResourceOrder,
} from "./marketplace-resources-model";
import type { GuardianFetch } from "./flows/client";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";

export function MarketplaceResources({
  orders,
  gFetch,
  refresh,
  loading,
  loadError,
}: {
  orders: ResourceOrder[];
  gFetch: GuardianFetch;
  refresh: () => Promise<void>;
  loading: boolean;
  loadError: string;
}) {
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<{ id: string; name: string } | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const resources = purchasedResources(orders);
  const visible = resources.filter((item) => filter === "all" || item.product.kind === filter);

  useEffect(() => {
    setSelected(null);
    setContent(null);
    setError("");
    setNotice("");
  }, [orders, gFetch]);

  useEffect(() => {
    if (!selected) return;
    let current = true;
    setPending(true);
    setError("");
    setContent(null);
    void gFetch(`/v1/guardian/marketplace/items/${encodeURIComponent(selected.id)}/delivery`)
      .then(marketplaceJson)
      .then((data) => {
        if (!current) return;
        if (data.content == null)
          throw new Error("The seller has not attached resource content yet.");
        setContent(
          typeof data.content === "string" ? data.content : JSON.stringify(data.content, null, 2),
        );
      })
      .catch((e) => {
        if (current) setError(e instanceof Error ? e.message : "Resource could not be loaded.");
      })
      .finally(() => {
        if (current) setPending(false);
      });
    return () => {
      current = false;
    };
  }, [selected, gFetch]);

  return (
    <section className="market-resources" aria-labelledby="resources-title">
      <header className="market-resources-heading">
        <div>
          <h2 id="resources-title">Your resources</h2>
          <p>Digital purchases, API results and access details supplied by your sellers.</p>
        </div>
        <button disabled={loading} onClick={() => void refresh().catch(() => {})}>
          <Icon name="swap" size={16} /> {loading ? "Refreshing…" : "Refresh resources"}
        </button>
      </header>
      <div className="minimal-tabs" role="group" aria-label="Resource type">
        {[
          ["all", "All resources"],
          ["service", "Tools & APIs"],
          ["digital", "Software & digital"],
        ].map(([value, label]) => (
          <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>
            {label}
          </button>
        ))}
      </div>
      {loadError && <p role="alert">Resources could not be refreshed. {loadError}</p>}
      {loading && !resources.length ? (
        <p role="status">Loading your purchased resources…</p>
      ) : visible.length ? (
        <div className="market-resource-list">
          {visible.map((item) => (
            <article className="market-resource-row" key={item.id}>
              <span className="market-resource-symbol" aria-hidden="true">
                <Icon name={item.product.kind === "service" ? "zap" : "layers"} size={24} />
              </span>
              <div className="market-resource-copy">
                <h3>{item.product.name}</h3>
                <p>
                  {item.product.kind === "service" ? "API / service" : "Digital product"} · Order{" "}
                  {item.orderId.slice(-8)}
                </p>
                <span>
                  {resourceReady(item)
                    ? "Ready to open"
                    : item.paymentState === "escrowed"
                      ? "Payment held · access pending"
                      : "Waiting for seller delivery"}
                </span>
              </div>
              <button
                disabled={!resourceReady(item)}
                onClick={() => {
                  setNotice("");
                  setSelected({ id: item.id, name: item.product.name });
                }}
              >
                {resourceReady(item) ? "Open resource" : "Access pending"}
                <Icon name="arrowRight" size={16} />
              </button>
            </article>
          ))}
        </div>
      ) : (
        !loadError && (
          <div className="market-resource-empty">
            <Icon name="layers" size={30} />
            <h3>
              {resources.length ? "No resources in this category" : "Your purchases belong here"}
            </h3>
            <p>
              {resources.length
                ? "Choose another resource type to see your purchases."
                : "Purchased digital goods and API resources will appear here once payment is confirmed. Physical orders stay in Purchases."}
            </p>
          </div>
        )
      )}
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) {
            setSelected(null);
            setContent(null);
            setError("");
          }
        }}
      >
        <DialogContent className="market-resource-dialog">
          <DialogTitle>{selected?.name ?? "Purchased resource"}</DialogTitle>
          <DialogDescription>
            Content supplied for your purchase. Keep credentials and license details private.
          </DialogDescription>
          {pending && <p role="status">Opening resource…</p>}
          {error && <p role="alert">{error}</p>}
          {content !== null && (
            <>
              <pre className="market-resource-content">{content}</pre>
              <div className="market-resource-actions">
                <button
                  onClick={() => {
                    void navigator.clipboard.writeText(content).then(
                      () => setNotice("Resource copied."),
                      () => setError("Copy failed. Select the content and copy it manually."),
                    );
                  }}
                >
                  Copy resource
                </button>
                <button
                  onClick={() => {
                    const url = URL.createObjectURL(
                      new Blob([content], { type: "text/plain;charset=utf-8" }),
                    );
                    const link = document.createElement("a");
                    link.href = url;
                    link.download = `abi-resource-${selected?.id ?? "purchase"}.txt`;
                    document.body.appendChild(link);
                    link.click();
                    link.remove();
                    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
                  }}
                >
                  Download resource
                </button>
              </div>
            </>
          )}
          {notice && <p role="status">{notice}</p>}
        </DialogContent>
      </Dialog>
    </section>
  );
}
