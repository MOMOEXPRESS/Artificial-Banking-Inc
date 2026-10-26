"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { browserApiBase } from "./browser-api";
import type { Session } from "./console-types";
import { agentClient, errCode, errMsg, guardianClient } from "./flows/client";
import * as A from "./flows/agent";
import * as G from "./flows/guardian";
import type { Policy } from "./policy-view";
import { Empty, Icon } from "./ui";

const API = browserApiBase();

export type DirectoryOffer = {
  id: string;
  slug: string;
  title: string;
  description: string;
  category: string;
  endpointUrl: string;
  hosted: boolean;
  priceUsdc: string;
  network: string;
  accessMode: "open" | "allowlist";
  payTo: string | null;
  version: string;
  deprecatedAt: string | null;
  sunsetAt: string | null;
  seller: { orgId: string; name: string; website: string | null; supportEmail: string | null };
};

type Purchase = {
  offerId: string;
  phase: "paying" | "awaiting_approval" | "done" | "refused";
  idempotencyKey: string;
  approvalId?: string;
  txHash?: string;
  amountUsdc?: string;
  content?: unknown;
  error?: string;
};

export function explorerTx(network: string, txHash: string): string {
  return network === "base"
    ? `https://basescan.org/tx/${txHash}`
    : `https://sepolia.basescan.org/tx/${txHash}`;
}

function normUrl(u: string): string {
  return u.trim().replace(/\/+$/, "").toLowerCase();
}

export async function fetchDirectory(): Promise<DirectoryOffer[]> {
  const res = await fetch(`${API}/v1/directory/offers`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Directory unavailable (${res.status})`);
  return ((await res.json()) as { offers: DirectoryOffer[] }).offers;
}

/**
 * The buyer side of the seller directory: find a business, connect your org to
 * it (allowlist the offer URL and register the merchant), then have an agent
 * buy through its normal policy-gated pay_api call.
 */
export function BusinessConnections({
  session,
  actor,
  policy,
  gFetch,
  readOnly,
  setToast,
  onPolicyChanged,
}: {
  session: Session;
  actor: { agentId: string; name: string; key: string } | undefined;
  policy: Policy | null;
  gFetch: (p: string, i?: RequestInit) => Promise<Response>;
  readOnly: boolean;
  setToast: (m: string, k?: "ok" | "err" | "info") => void;
  onPolicyChanged?: () => void;
}) {
  const guardian = useMemo(() => guardianClient(gFetch), [gFetch]);
  const [offers, setOffers] = useState<DirectoryOffer[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [allowlist, setAllowlist] = useState<string[]>(policy?.vendorAllowlist ?? []);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [purchases, setPurchases] = useState<Record<string, Purchase>>({});

  useEffect(() => {
    if (policy) setAllowlist(policy.vendorAllowlist ?? []);
  }, [policy]);

  const load = useCallback(async () => {
    try {
      setOffers(await fetchDirectory());
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const connected = useCallback(
    (offer: DirectoryOffer) => allowlist.map(normUrl).includes(normUrl(offer.endpointUrl)),
    [allowlist],
  );

  const sellers = useMemo(() => {
    const q = query.trim().toLowerCase();
    const groups = new Map<
      string,
      { seller: DirectoryOffer["seller"]; offers: DirectoryOffer[] }
    >();
    for (const o of offers ?? []) {
      const hay = [o.title, o.description, o.category, o.seller.name].join(" ").toLowerCase();
      if (q && !hay.includes(q)) continue;
      const g = groups.get(o.seller.orgId) ?? { seller: o.seller, offers: [] };
      g.offers.push(o);
      groups.set(o.seller.orgId, g);
    }
    return [...groups.values()];
  }, [offers, query]);

  const patchPurchase = (offerId: string, p: Partial<Purchase>) =>
    setPurchases((all) => ({ ...all, [offerId]: { ...all[offerId], offerId, ...p } as Purchase }));

  async function connect(offer: DirectoryOffer) {
    if (
      !window.confirm(
        `Connect to ${offer.seller.name}?\n\nThis adds ${offer.endpointUrl} to your vendor allowlist so your agents may pay it (${offer.priceUsdc} USDC per call). Your spending caps and approval threshold still apply.`,
      )
    )
      return;
    setBusyId(offer.id);
    try {
      const next = [
        ...allowlist.filter((u) => normUrl(u) !== normUrl(offer.endpointUrl)),
        offer.endpointUrl,
      ];
      const pol = await G.updatePolicy(guardian, { vendorAllowlist: next });
      if (pol.status >= 400)
        throw new Error(errMsg(pol.data) || errCode(pol.data) || "Policy update failed");
      const merchant = await guardian.call("POST", "/v1/guardian/merchants", {
        key: offer.endpointUrl,
        label: `${offer.seller.name} · ${offer.title}`,
        category: offer.category,
        meta: {
          source: "abi-directory",
          offerId: offer.id,
          sellerOrgId: offer.seller.orgId,
          payTo: offer.payTo,
          network: offer.network,
          priceUsdc: offer.priceUsdc,
        },
      });
      if (merchant.status >= 400) {
        setToast(
          `Allowlisted, but the merchant record needs an owner: ${errMsg(merchant.data) || merchant.status}`,
          "info",
        );
      } else {
        setToast(`Connected to ${offer.seller.name}`, "ok");
      }
      setAllowlist(next);
      onPolicyChanged?.();
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e), "err");
    } finally {
      setBusyId(null);
    }
  }

  async function disconnect(offer: DirectoryOffer) {
    setBusyId(offer.id);
    try {
      const next = allowlist.filter((u) => normUrl(u) !== normUrl(offer.endpointUrl));
      const pol = await G.updatePolicy(guardian, { vendorAllowlist: next });
      if (pol.status >= 400) throw new Error(errMsg(pol.data) || "Policy update failed");
      setAllowlist(next);
      setToast(`Disconnected from ${offer.seller.name}`, "ok");
      onPolicyChanged?.();
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e), "err");
    } finally {
      setBusyId(null);
    }
  }

  function settle(offer: DirectoryOffer, data: Record<string, unknown>, key: string) {
    const resource = data.resource as { content?: unknown } | undefined;
    patchPurchase(offer.id, {
      phase: "done",
      idempotencyKey: key,
      txHash: typeof data.txHash === "string" ? data.txHash : undefined,
      amountUsdc: typeof data.amountUsdc === "string" ? data.amountUsdc : offer.priceUsdc,
      content: resource?.content ?? resource,
      error: undefined,
    });
    setToast(`Bought ${offer.title} for ${String(data.amountUsdc ?? offer.priceUsdc)} USDC`, "ok");
  }

  async function payOnce(offer: DirectoryOffer, key: string) {
    if (!actor) return;
    const agent = agentClient(API, actor.key);
    const { status, data } = await A.payApi(agent, {
      amountUsdc: offer.priceUsdc,
      destination: offer.endpointUrl,
      idempotencyKey: key,
      memo: `${offer.seller.name}: ${offer.title}`,
    });
    if (status === 202 && data.approvalId) {
      patchPurchase(offer.id, {
        phase: "awaiting_approval",
        approvalId: String(data.approvalId),
        idempotencyKey: key,
      });
      return waitForApproval(offer, String(data.approvalId), key);
    }
    if (status >= 400) {
      patchPurchase(offer.id, {
        phase: "refused",
        idempotencyKey: key,
        error: `${errCode(data) || status}: ${errMsg(data) || "refused"}`,
      });
      return;
    }
    settle(offer, data, key);
  }

  async function waitForApproval(offer: DirectoryOffer, approvalId: string, key: string) {
    if (!actor) return;
    const agent = agentClient(API, actor.key);
    for (let i = 0; i < 450; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const { data } = await A.getApproval(agent, approvalId).catch(() => ({
        status: 0,
        data: {} as Record<string, unknown>,
      }));
      const st = (data.approval as Record<string, string> | undefined)?.status;
      if (st === "approved") {
        const replay = await A.payApi(agent, {
          amountUsdc: offer.priceUsdc,
          destination: offer.endpointUrl,
          idempotencyKey: key,
        });
        if (replay.status >= 400) {
          patchPurchase(offer.id, {
            phase: "refused",
            error: `${errCode(replay.data) || replay.status}: ${errMsg(replay.data)}`,
          });
        } else {
          settle(offer, replay.data, key);
        }
        return;
      }
      if (st === "denied" || st === "expired") {
        patchPurchase(offer.id, { phase: "refused", error: `Approval ${st}.` });
        return;
      }
    }
  }

  async function buy(offer: DirectoryOffer) {
    if (!actor) return;
    const key = `buy-${offer.id}-${Date.now().toString(36)}`;
    patchPurchase(offer.id, { phase: "paying", idempotencyKey: key, error: undefined });
    try {
      await payOnce(offer, key);
    } catch (e) {
      patchPurchase(offer.id, {
        phase: "refused",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  async function approve(offer: DirectoryOffer, approvalId: string, yes: boolean) {
    const { status, data } = await G.resolveApproval(guardian, approvalId, yes, "playground");
    if (status >= 400) setToast(errMsg(data) || "Could not resolve approval", "err");
  }

  return (
    <section className="lab-panel" data-testid="business-connections">
      <div className="lab-section-head">
        <div>
          <span className="lab-kicker">Businesses</span>
          <h2>Connect to businesses and buy with an agent</h2>
          <p>
            Every published seller offer in the ABI directory. Connect your org to one, then your
            agent pays it through the same policy check as any other purchase: USDC settles on-chain
            to the seller’s wallet and the content unlocks.
          </p>
        </div>
        <label className="lab-search">
          <Icon name="search" size={15} />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search businesses"
            aria-label="Search businesses"
          />
        </label>
      </div>

      {loadError ? (
        <Empty icon="alert">Directory unavailable: {loadError}</Empty>
      ) : offers === null ? (
        <p className="faint">Loading the directory…</p>
      ) : sellers.length === 0 ? (
        <Empty icon="search">
          No businesses yet. When a seller publishes an offer and lists it, it appears here.
        </Empty>
      ) : (
        <div style={{ display: "grid", gap: 14 }}>
          {sellers.map(({ seller, offers: list }) => (
            <div key={seller.orgId} className="card" style={{ padding: 16 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <b style={{ fontSize: 15 }}>{seller.name}</b>
                  <div className="faint" style={{ fontSize: 12 }}>
                    {seller.website ? (
                      <a href={seller.website} target="_blank" rel="noreferrer">
                        {seller.website.replace(/^https?:\/\//, "")}
                      </a>
                    ) : (
                      "ABI seller"
                    )}
                    {seller.supportEmail ? ` · ${seller.supportEmail}` : ""}
                  </div>
                </div>
              </div>
              {list.map((o) => {
                const isConnected = connected(o);
                const p = purchases[o.id];
                return (
                  <div
                    key={o.id}
                    data-testid={`offer-${o.slug}`}
                    style={{ borderTop: "1px solid var(--border)", marginTop: 12, paddingTop: 12 }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 12,
                        flexWrap: "wrap",
                      }}
                    >
                      <div style={{ minWidth: 0, flex: "1 1 260px" }}>
                        <b>{o.title}</b>{" "}
                        <span className="faint" style={{ fontSize: 12 }}>
                          {o.version} · {o.category} · {o.priceUsdc} USDC on {o.network}
                          {o.accessMode === "allowlist" ? " · approved buyers only" : ""}
                          {o.deprecatedAt ? " · deprecated" : ""}
                        </span>
                        {o.description && (
                          <p className="faint" style={{ fontSize: 12.5, margin: "4px 0 0" }}>
                            {o.description}
                          </p>
                        )}
                      </div>
                      <div
                        style={{
                          display: "flex",
                          gap: 6,
                          alignItems: "flex-start",
                          flexWrap: "wrap",
                        }}
                      >
                        {isConnected ? (
                          <>
                            <span className="pill ok">
                              <i /> connected
                            </span>
                            <Button
                              size="sm"
                              disabled={
                                !actor || p?.phase === "paying" || p?.phase === "awaiting_approval"
                              }
                              onClick={() => void buy(o)}
                              title={actor ? undefined : "Add an agent key below first"}
                            >
                              {p?.phase === "paying"
                                ? "Paying…"
                                : `Buy with ${actor?.name ?? "agent"} · ${o.priceUsdc} USDC`}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={readOnly || busyId === o.id}
                              onClick={() => void disconnect(o)}
                            >
                              Disconnect
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={readOnly || busyId === o.id}
                            onClick={() => void connect(o)}
                          >
                            {busyId === o.id ? "Connecting…" : "Connect"}
                          </Button>
                        )}
                      </div>
                    </div>
                    {p && (
                      <PurchaseResult offer={o} p={p} readOnly={readOnly} onResolve={approve} />
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
      {session.agentKeys.length === 0 && (
        <p className="faint" style={{ fontSize: 12.5, marginTop: 10 }}>
          Add an agent key in Run controls to buy. The agent pays from its own budget.
        </p>
      )}
    </section>
  );
}

function PurchaseResult({
  offer,
  p,
  readOnly,
  onResolve,
}: {
  offer: DirectoryOffer;
  p: Purchase;
  readOnly: boolean;
  onResolve: (offer: DirectoryOffer, approvalId: string, approve: boolean) => Promise<void>;
}) {
  const box = {
    marginTop: 10,
    padding: "10px 12px",
    borderRadius: 10,
    background: "var(--surface-3)",
    border: "1px solid var(--border)",
    fontSize: 12.5,
  } as const;
  if (p.phase === "paying") {
    return (
      <div style={box} role="status">
        Asking policy, signing and settling on {offer.network}…
      </div>
    );
  }
  if (p.phase === "awaiting_approval" && p.approvalId) {
    return (
      <div style={box} role="status">
        <b>Waiting for a guardian.</b> Your policy parks this purchase for approval (first payment
        to a new business, or above your threshold). Nothing has been signed yet.
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <Button
            size="sm"
            disabled={readOnly}
            onClick={() => void onResolve(offer, p.approvalId!, true)}
          >
            Approve
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={readOnly}
            onClick={() => void onResolve(offer, p.approvalId!, false)}
          >
            Deny
          </Button>
        </div>
      </div>
    );
  }
  if (p.phase === "refused") {
    return (
      <div style={{ ...box, color: "var(--bad, var(--color-danger))" }} role="alert">
        Not bought. {p.error}
      </div>
    );
  }
  return (
    <div style={box} data-testid="purchase-done">
      <b>Bought for {p.amountUsdc} USDC.</b>{" "}
      {p.txHash ? (
        <a href={explorerTx(offer.network, p.txHash)} target="_blank" rel="noreferrer">
          View transaction {p.txHash.slice(0, 10)}…{p.txHash.slice(-6)}
        </a>
      ) : (
        <span className="faint">No transaction hash returned.</span>
      )}
      {p.content !== undefined && (
        <pre
          className="mono"
          style={{
            whiteSpace: "pre-wrap",
            margin: "8px 0 0",
            fontSize: 12,
            maxHeight: 260,
            overflow: "auto",
          }}
        >
          {typeof p.content === "string" ? p.content : JSON.stringify(p.content, null, 2)}
        </pre>
      )}
    </div>
  );
}
