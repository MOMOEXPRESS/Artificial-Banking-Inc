"use client";
import { useCallback, useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { marketplaceJson } from "./marketplace-catalog";
import { Icon } from "./ui";
type Window = {
  startsAt: string | null;
  endsAt: string | null;
  totalMaxUsdc: string | null;
  label: string | null;
  period?: "day" | "week" | "month" | "total";
  scope?: "agent" | "workspace";
  allowRecurringPurchases?: boolean;
};
type Policy = {
  perTxMaxUsdc: string;
  dailyMaxUsdc: string;
  hitlAboveUsdc: string;
  budgetWindow: Window | null;
};
type Fetcher = (p: string, i?: RequestInit) => Promise<Response>;
const decimal = /^\d+(\.\d{1,6})?$/;
export function SpendingLimits({ gFetch, readOnly }: { gFetch: Fetcher; readOnly: boolean }) {
  const [policy, setPolicy] = useState<Policy | null>(null),
    [open, setOpen] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const [name, setName] = useState("Workspace spending"),
    [amount, setAmount] = useState("100"),
    [period, setPeriod] = useState("month"),
    [perPurchase, setPerPurchase] = useState("25"),
    [approval, setApproval] = useState(false),
    [recurring, setRecurring] = useState(false),
    [expires, setExpires] = useState("");
  const load = useCallback(async () => {
    try {
      const d = await marketplaceJson(await gFetch("/v1/guardian/policy"));
      setPolicy(d.policy);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load spending limits. Try again.");
    }
  }, [gFetch]);
  useEffect(() => {
    void load();
  }, [load]);
  function edit() {
    setError("");
    setName(policy?.budgetWindow?.label ?? "Workspace spending");
    setAmount(policy?.budgetWindow?.totalMaxUsdc ?? "100");
    setPeriod(policy?.budgetWindow?.period ?? (policy?.budgetWindow ? "total" : "month"));
    setPerPurchase(policy?.perTxMaxUsdc ?? "25");
    setApproval(Number(policy?.hitlAboveUsdc) === 0);
    setRecurring(policy?.budgetWindow?.allowRecurringPurchases ?? false);
    setExpires(
      (policy?.budgetWindow?.endsAt ?? new Date(Date.now() + 89 * 86400000).toISOString()).slice(
        0,
        10,
      ),
    );
    setOpen(true);
  }
  async function save() {
    if (!policy) return;
    if (
      !decimal.test(amount) ||
      !decimal.test(perPurchase) ||
      Number(amount) <= 0 ||
      Number(perPurchase) <= 0
    ) {
      setError("Enter positive USDC amounts with at most six decimal places.");
      return;
    }
    if (Number(perPurchase) > Number(policy.dailyMaxUsdc)) {
      setError(
        `The per-purchase amount must fit the existing daily limit of ${policy.dailyMaxUsdc} USDC.`,
      );
      return;
    }
    const startsAt =
      period === "total"
        ? ((!policy.budgetWindow?.period || policy.budgetWindow.period === "total"
            ? policy.budgetWindow?.startsAt
            : null) ?? new Date().toISOString())
        : undefined;
    const endsAt =
      period === "total" ? new Date(expires + "T23:59:59.999Z").toISOString() : undefined;
    setBusy(true);
    setError("");
    try {
      await marketplaceJson(
        await gFetch("/v1/guardian/policy", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            perTxMaxUsdc: perPurchase,
            hitlAboveUsdc: approval
              ? "0"
              : Number(policy.hitlAboveUsdc) === 0
                ? perPurchase
                : policy.hitlAboveUsdc,
            budgetWindow: {
              label: name,
              totalMaxUsdc: amount,
              scope: "workspace",
              ...(period !== "total" ? { period } : { startsAt, endsAt }),
              allowRecurringPurchases: recurring,
            },
          }),
        }),
      );
      await load();
      setOpen(false);
      setNotice("Spending limit saved. Existing agent budgets and approval rules still apply.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the limit. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    setError("");
    try {
      await marketplaceJson(
        await gFetch("/v1/guardian/policy", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ budgetWindow: null }),
        }),
      );
      await load();
      setNotice("Period limit removed. Per-purchase and daily policy limits remain in effect.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove this limit.");
    } finally {
      setBusy(false);
    }
  }
  const win = policy?.budgetWindow;
  return (
    <section className="reference-spending">
      <div className="minimal-section-heading">
        <h2>Spending limits</h2>
        <button className="minimal-primary" disabled={readOnly || busy || !policy} onClick={edit}>
          <Icon name="plus" size={16} />
          {win ? "Edit limit" : "Add limit"}
        </button>
      </div>
      <p>Set how much your agents can spend. Periods reset in UTC.</p>
      {notice && <p role="status">{notice}</p>}
      {error && !open && (
        <p className="minimal-error" role="alert">
          {error}
          <button onClick={() => void load()}>Try again</button>
        </p>
      )}
      {!policy && !error && <p role="status">Loading spending limits…</p>}
      {policy && (
        <>
          <article className="reference-limit-row">
            <div>
              <h3>{win?.label ?? "Purchase controls"}</h3>
              <p>
                {win
                  ? `${win.totalMaxUsdc ?? "No"} USDC · ${win.period && win.period !== "total" ? `per ${win.period}` : "total"}`
                  : `${policy.perTxMaxUsdc} USDC per purchase`}
              </p>
              <small>
                {win?.scope === "workspace"
                  ? "Shared across this workspace’s agents"
                  : "Existing agent policies"}
              </small>
              {win?.endsAt && <small>Ends {new Date(win.endsAt).toLocaleDateString()}</small>}
            </div>
            <button disabled={busy || readOnly} onClick={edit}>
              Manage
            </button>
          </article>
          <dl className="reference-policy-summary">
            <div>
              <dt>Maximum per purchase</dt>
              <dd>{policy.perTxMaxUsdc} USDC</dd>
            </div>
            <div>
              <dt>Existing daily limit per agent</dt>
              <dd>{policy.dailyMaxUsdc} USDC</dd>
            </div>
            <div>
              <dt>Approval required above</dt>
              <dd>{policy.hitlAboveUsdc} USDC</dd>
            </div>
            <div>
              <dt>Recurring purchases</dt>
              <dd>{win?.allowRecurringPurchases === false ? "Blocked" : "Subject to policy"}</dd>
            </div>
          </dl>
          {win && (
            <button
              className="reference-remove-limit"
              disabled={busy || readOnly}
              onClick={() => void remove()}
            >
              Remove period limit
            </button>
          )}
        </>
      )}
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!busy) setOpen(v);
        }}
      >
        <DialogContent className="reference-dialog">
          <DialogTitle>{win ? "Edit spending limit" : "Add spending limit"}</DialogTitle>
          <DialogDescription>
            Agents in this workspace share the period cap. Their assigned budgets and other policy
            checks still apply.
          </DialogDescription>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            {error && (
              <p role="alert" className="minimal-error">
                {error}
              </p>
            )}
            <label>
              Name
              <input
                required
                value={name}
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <div className="reference-form-pair">
              <label>
                Limit in USDC
                <input
                  required
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
              <label>
                Period
                <select value={period} onChange={(e) => setPeriod(e.target.value)}>
                  <option value="total">Total</option>
                  <option value="day">Per day</option>
                  <option value="week">Per week</option>
                  <option value="month">Per month</option>
                </select>
              </label>
            </div>
            {period === "total" && (
              <label>
                Ends on
                <input
                  required
                  type="date"
                  min={new Date().toISOString().slice(0, 10)}
                  max={new Date(Date.now() + 89 * 86400000).toISOString().slice(0, 10)}
                  value={expires}
                  onChange={(e) => setExpires(e.target.value)}
                />
                <small>A total limit has an expiry within 90 days.</small>
              </label>
            )}
            <div className="reference-services">
              <span>Services</span>
              <p>All services and purchases</p>
            </div>
            <label>
              Maximum per purchase in USDC
              <input
                required
                inputMode="decimal"
                value={perPurchase}
                onChange={(e) => setPerPurchase(e.target.value)}
              />
            </label>
            <label className="reference-switch-row">
              Require approval for each purchase
              <input
                type="checkbox"
                role="switch"
                checked={approval}
                onChange={(e) => setApproval(e.target.checked)}
              />
            </label>
            <label className="reference-switch-row">
              Allow recurring purchases
              <input
                type="checkbox"
                role="switch"
                checked={recurring}
                onChange={(e) => setRecurring(e.target.checked)}
              />
            </label>
            <label className="reference-switch-row">
              Allow changes in connected services
              <input
                type="checkbox"
                role="switch"
                checked={false}
                disabled
                aria-describedby="write-capability"
              />
            </label>
            <p id="write-capability" className="minimal-note">
              Connected-service write actions are not available yet.
            </p>
            <div className="reference-dialog-actions">
              <button className="minimal-primary" disabled={busy || readOnly}>
                {busy ? "Saving…" : "Save limit"}
              </button>
              <button type="button" disabled={busy} onClick={() => setOpen(false)}>
                Cancel
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
