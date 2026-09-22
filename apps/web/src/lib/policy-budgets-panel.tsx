"use client";

/**
 * Categories, time-boxed budgets and counterparty risk (P6-T3 / P6-T4).
 *
 * Its own file, and its own tab, on purpose: these are opt-in controls most
 * orgs never touch, and folding them into the always-visible limits editor
 * would bury the four settings everyone does use. Each section saves
 * independently, so a half-finished category cannot block a limit change.
 */

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Policy } from "./policy-view";

type Caps = NonNullable<Policy["categoryCaps"]>;
type Window = NonNullable<Policy["budgetWindow"]>;

export function BudgetsPanel({
  policy,
  gFetch,
  act,
  locked,
}: {
  policy: Policy;
  gFetch: (p: string, i?: RequestInit) => Promise<Response>;
  act: (label: string, fn: () => Promise<string | void>) => Promise<void>;
  locked: boolean;
}) {
  const [caps, setCaps] = useState<Caps>(() => policy.categoryCaps ?? {});
  const [win, setWin] = useState<Window | null>(() => policy.budgetWindow ?? null);
  const [risk, setRisk] = useState<number | null>(policy.counterpartyRiskReviewAbove ?? null);
  const [draftCategory, setDraftCategory] = useState("");
  const [merchantCaps, setMerchantCaps] = useState<Record<string, string>>(
    () => policy.merchantDailyCaps ?? {},
  );
  const [merchantEndpoint, setMerchantEndpoint] = useState("");
  const [merchantAmount, setMerchantAmount] = useState("");
  const [merchantUsage, setMerchantUsage] = useState<
    Record<string, { spentUsdc: string; reservedUsdc: string; remainingUsdc: string }>
  >({});
  const [merchantError, setMerchantError] = useState("");

  const refreshMerchantUsage = useCallback(async () => {
    try {
      const response = await gFetch("/v1/guardian/policy/merchant-spend");
      if (!response.ok) throw new Error("Could not load merchant spend");
      const data = await response.json();
      setMerchantUsage(
        Object.fromEntries(
          (data.merchants ?? []).map(
            (entry: {
              destination: string;
              spentUsdc: string;
              reservedUsdc: string;
              remainingUsdc: string;
            }) => [entry.destination, entry],
          ),
        ),
      );
      setMerchantError("");
    } catch {
      setMerchantError("Merchant spend is temporarily unavailable.");
    }
  }, [gFetch]);

  useEffect(() => {
    void refreshMerchantUsage();
  }, [refreshMerchantUsage]);

  const saveMerchantCaps = (next: Record<string, string>) =>
    act("Merchant caps", async () => {
      await patch({ merchantDailyCaps: next });
      setMerchantCaps(next);
      await refreshMerchantUsage();
      return "Shared merchant caps saved. Agents and pending approvals use the new limits.";
    });

  const patch = async (body: Record<string, unknown>) => {
    const res = await gFetch("/v1/guardian/policy", {
      method: "POST",
      body: JSON.stringify(body),
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error?.message ?? JSON.stringify(d));
  };

  const saveCaps = (next: Caps) =>
    act("Category caps", async () => {
      await patch({
        categoryCaps: Object.fromEntries(
          Object.entries(next).map(([name, cap]) => [
            name,
            {
              ...(cap.dailyMaxUsdc ? { dailyMaxUsdc: cap.dailyMaxUsdc } : {}),
              ...(cap.perTxMaxUsdc ? { perTxMaxUsdc: cap.perTxMaxUsdc } : {}),
              ...(cap.hitlAboveUsdc ? { hitlAboveUsdc: cap.hitlAboveUsdc } : {}),
              blocked: cap.blocked,
            },
          ]),
        ),
      });
      setCaps(next);
      return "Category caps saved.";
    });

  const saveWindow = (next: Window | null) =>
    act("Budget window", async () => {
      await patch({
        budgetWindow: next
          ? {
              startsAt: next.startsAt,
              endsAt: next.endsAt,
              totalMaxUsdc: next.totalMaxUsdc,
              ...(next.label ? { label: next.label } : {}),
            }
          : null,
      });
      setWin(next);
      return next ? "Budget window saved." : "Budget window cleared.";
    });

  const saveRisk = (next: number | null) =>
    act("Counterparty risk", async () => {
      await patch({ counterpartyRiskReviewAbove: next });
      setRisk(next);
      return next === null
        ? "Counterparty scoring disabled — the allowlist is the only signal again."
        : `Payments now park for approval above risk ${next}/100.`;
    });

  /** Keep every field present so a partial edit never drops the others. */
  const editWindow = (patchWin: Partial<Window>) =>
    setWin({
      startsAt: win?.startsAt ?? null,
      endsAt: win?.endsAt ?? null,
      totalMaxUsdc: win?.totalMaxUsdc ?? null,
      label: win?.label ?? null,
      ...patchWin,
    });

  const expired = win?.endsAt ? Date.parse(win.endsAt) < Date.now() : false;

  return (
    <div className="grid g-main fill">
      <div className="card">
        <div className="card-head">
          <div>
            <h2 style={{ margin: 0 }}>Spend categories</h2>
            <div className="sub">
              Caps on what the money is for, not just how much. The category comes from the merchant
              record — destinations without one are governed by the limits alone.
            </div>
          </div>
        </div>

        {Object.keys(caps).length === 0 ? (
          <p className="faint" style={{ fontSize: 12.5, lineHeight: 1.6 }}>
            No category caps yet. Add one to express what the overall limits cannot — like
            &ldquo;inference is capped at $200/day, but security tooling never is&rdquo;.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {Object.entries(caps).map(([name, cap]) => (
              <div key={name} className="between" style={{ gap: 10, flexWrap: "wrap" }}>
                <b style={{ fontSize: 13, minWidth: 110 }}>{name}</b>
                <input
                  className="input sm"
                  style={{ maxWidth: 130 }}
                  placeholder="daily max"
                  value={cap.dailyMaxUsdc ?? ""}
                  disabled={locked}
                  data-shortcut-ignore
                  onChange={(e) =>
                    setCaps({ ...caps, [name]: { ...cap, dailyMaxUsdc: e.target.value || null } })
                  }
                />
                <input
                  className="input sm"
                  style={{ maxWidth: 130 }}
                  placeholder="approve above"
                  value={cap.hitlAboveUsdc ?? ""}
                  disabled={locked}
                  data-shortcut-ignore
                  onChange={(e) =>
                    setCaps({ ...caps, [name]: { ...cap, hitlAboveUsdc: e.target.value || null } })
                  }
                />
                <label className="row" style={{ gap: 6, fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={cap.blocked}
                    disabled={locked}
                    onChange={(e) =>
                      setCaps({ ...caps, [name]: { ...cap, blocked: e.target.checked } })
                    }
                  />
                  block
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={locked}
                  onClick={() => {
                    const next = { ...caps };
                    delete next[name];
                    void saveCaps(next);
                  }}
                >
                  Remove
                </Button>
              </div>
            ))}
            <div>
              <Button type="button" size="sm" disabled={locked} onClick={() => void saveCaps(caps)}>
                Save categories
              </Button>
            </div>
          </div>
        )}

        <div className="row" style={{ gap: 8, marginTop: 12 }}>
          <input
            className="input sm"
            placeholder="category name (e.g. inference)"
            value={draftCategory}
            disabled={locked}
            data-shortcut-ignore
            onChange={(e) => setDraftCategory(e.target.value)}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={locked || !draftCategory.trim()}
            onClick={() => {
              const key = draftCategory.trim().toLowerCase();
              setDraftCategory("");
              if (!key || caps[key]) return;
              setCaps({
                ...caps,
                [key]: {
                  perTxMaxUsdc: null,
                  dailyMaxUsdc: null,
                  hitlAboveUsdc: null,
                  blocked: false,
                },
              });
            }}
          >
            Add category
          </Button>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="card">
          <div className="card-head">
            <div>
              <h2 style={{ margin: 0 }}>Merchant ceilings</h2>
              <div className="sub">
                One rolling 24h USDC ceiling per exact paid endpoint, shared by every agent.
                Approvals recheck it before release.
              </div>
            </div>
          </div>
          {Object.entries(merchantCaps).map(([destination, cap]) => (
            <div key={destination} className="kv" style={{ alignItems: "flex-start" }}>
              <span className="k mono" style={{ overflowWrap: "anywhere" }}>
                {destination}
              </span>
              <span className="v" style={{ textAlign: "right" }}>
                ${merchantUsage[destination]?.spentUsdc ?? "—"} / ${cap} spent
                <br />
                <span className="faint">
                  ${merchantUsage[destination]?.reservedUsdc ?? "—"} in progress
                </span>
                <br />
                <span className="faint">
                  ${merchantUsage[destination]?.remainingUsdc ?? "—"} left
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={locked}
                  aria-label={`Remove cap for ${destination}`}
                  onClick={() => {
                    const next = { ...merchantCaps };
                    delete next[destination];
                    void saveMerchantCaps(next);
                  }}
                >
                  Remove
                </Button>
              </span>
            </div>
          ))}
          {!Object.keys(merchantCaps).length && <p className="faint">No merchant ceilings yet.</p>}
          <label style={{ fontSize: 12, display: "block", marginTop: 12 }}>
            Exact paid endpoint
            <input
              className="input sm"
              placeholder="https://seller.example/report"
              value={merchantEndpoint}
              disabled={locked}
              onChange={(e) => setMerchantEndpoint(e.target.value)}
            />
          </label>
          <label style={{ fontSize: 12, display: "block", marginTop: 8 }}>
            Maximum USDC per rolling 24h (0 blocks the merchant)
            <input
              className="input sm"
              inputMode="decimal"
              placeholder="10.00"
              value={merchantAmount}
              disabled={locked}
              onChange={(e) => setMerchantAmount(e.target.value)}
            />
          </label>
          <Button
            type="button"
            size="sm"
            style={{ marginTop: 10 }}
            disabled={locked || !merchantEndpoint.trim() || !merchantAmount.trim()}
            onClick={() => {
              const endpoint = merchantEndpoint.trim().toLowerCase();
              if (
                !/^https?:\/\/[^/]+\/[^?]+/.test(endpoint) ||
                !/^\d+(?:\.\d{1,6})?$/.test(merchantAmount) ||
                (Object.keys(merchantCaps).length >= 50 && !(endpoint in merchantCaps))
              ) {
                setMerchantError(
                  "Enter an HTTP paid endpoint and a non-negative USDC amount (up to six decimals; 50 caps maximum).",
                );
                return;
              }
              setMerchantError("");
              void saveMerchantCaps({ ...merchantCaps, [endpoint]: merchantAmount.trim() });
              setMerchantEndpoint("");
              setMerchantAmount("");
            }}
          >
            Save merchant ceiling
          </Button>
          {merchantError && (
            <p role="alert" className="faint">
              {merchantError}
            </p>
          )}
          <p className="faint" style={{ fontSize: 12, lineHeight: 1.55 }}>
            This cap does not allowlist a seller. Set Policy → Allowlists separately. Spend comes
            from settled ABI payments and excludes payments made outside ABI. Check current spend
            before changing a cap; lowering it below money already spent blocks further payments
            until the rolling window clears.
          </p>
        </div>
        <div className="card">
          <div className="card-head">
            <div>
              <h2 style={{ margin: 0 }}>Time-boxed budget</h2>
              <div className="sub">
                A total and an end date. Past the end, every payment is refused — the safety expiry
                for an agent nobody remembers deploying.
              </div>
            </div>
            {expired && (
              <span className="pill warn">
                <i /> expired
              </span>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <label style={{ fontSize: 12 }}>
              Label
              <input
                className="input sm"
                placeholder="Q2 paid-acquisition test"
                value={win?.label ?? ""}
                disabled={locked}
                data-shortcut-ignore
                onChange={(e) => editWindow({ label: e.target.value || null })}
              />
            </label>
            <label style={{ fontSize: 12 }}>
              Total for the whole window (USDC)
              <input
                className="input sm"
                placeholder="5000"
                value={win?.totalMaxUsdc ?? ""}
                disabled={locked}
                data-shortcut-ignore
                onChange={(e) => editWindow({ totalMaxUsdc: e.target.value || null })}
              />
            </label>
            <label style={{ fontSize: 12 }}>
              Ends
              <input
                className="input sm"
                type="date"
                value={win?.endsAt ? win.endsAt.slice(0, 10) : ""}
                disabled={locked}
                data-shortcut-ignore
                onChange={(e) =>
                  editWindow({
                    endsAt: e.target.value
                      ? new Date(`${e.target.value}T23:59:59Z`).toISOString()
                      : null,
                  })
                }
              />
            </label>
            <div className="row" style={{ gap: 8 }}>
              <Button
                type="button"
                size="sm"
                disabled={locked}
                onClick={() => void saveWindow(win)}
              >
                Save budget
              </Button>
              {win && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={locked}
                  onClick={() => void saveWindow(null)}
                >
                  Clear
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div>
              <h2 style={{ margin: 0 }}>Counterparty risk</h2>
              <div className="sub">
                The allowlist is yes-or-no. This scores a destination 0–100 on age, payment history
                and screening, and parks anything above the threshold — so an allowlisted but
                brand-new vendor still gets a look.
              </div>
            </div>
          </div>
          <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
            <input
              className="input sm"
              style={{ maxWidth: 110 }}
              type="number"
              min={0}
              max={100}
              placeholder="off"
              value={risk ?? ""}
              disabled={locked}
              data-shortcut-ignore
              onChange={(e) => setRisk(e.target.value === "" ? null : Number(e.target.value))}
            />
            <Button type="button" size="sm" disabled={locked} onClick={() => void saveRisk(risk)}>
              Save threshold
            </Button>
            {risk !== null && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={locked}
                onClick={() => void saveRisk(null)}
              >
                Disable
              </Button>
            )}
          </div>
          <p className="faint" style={{ fontSize: 12, marginTop: 10, lineHeight: 1.55 }}>
            A destination never paid before scores 100. One known for a month with a handful of
            payments scores near zero. Left off, the allowlist stays the only signal.
          </p>
        </div>
      </div>
    </div>
  );
}
