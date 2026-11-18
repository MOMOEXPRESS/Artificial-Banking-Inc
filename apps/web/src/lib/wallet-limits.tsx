"use client";
import { useEffect, useState } from "react";
import {
  Check,
  ChevronDown,
  Plus,
  Search,
  ShieldCheck,
  Wallet,
  SlidersHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { workspaceJson, type Workspace, type WorkspaceFetcher } from "./workspace-client";
type Service = { id: string; name: string; provider: string; providerId: string; endpoint: string };
type Props = {
  workspaces: Workspace[];
  workspace: Workspace;
  gFetch: WorkspaceFetcher;
  onChanged: () => Promise<void>;
  readOnly: boolean;
};
export function WalletSpendingLimits(props: Props) {
  const [open, setOpen] = useState(false),
    [selected, setSelected] = useState(props.workspace.id),
    [notice, setNotice] = useState("");
  const items = props.workspaces.filter((w) => w.orgId === props.workspace.orgId);
  return (
    <section className="minimal-section abi-wallet-limits">
      <div className="minimal-section-heading">
        <div>
          <h2>Spending limits</h2>
          <p>
            Agent limits · Base Sepolia. Workspace caps apply to all connected agents together.
            Mainnet owner transfers use separate treasury withdrawal controls.
          </p>
        </div>
        <Button
          disabled={props.readOnly}
          onClick={() => {
            setSelected(props.workspace.id);
            setOpen(true);
          }}
        >
          <Plus size={16} />
          Add limit
        </Button>
      </div>
      {notice && (
        <p role="status" className="abi-inline-notice">
          <Check size={16} />
          {notice}
        </p>
      )}
      <div className="abi-key-list">
        {items.map((w) => (
          <article key={w.id}>
            <span className="abi-key-symbol">
              <ShieldCheck size={21} />
            </span>
            <div>
              <h3>{w.name}</h3>
              <p>
                {w.card.limitUsdc === null
                  ? "Existing account and agent limits"
                  : `${w.card.limitUsdc} USDC · ${w.card.period === "total" ? "Total" : `Per ${w.card.period}`}`}
              </p>
              <small>
                {w.card.services === null || w.card.services === undefined
                  ? "All services"
                  : `${w.card.services.length} enabled ${w.card.services.length === 1 ? "tool" : "tools"}`}{" "}
                · {w.card.spentUsdc} spent · {w.card.pendingUsdc} reserved
              </small>
              {Object.entries(w.card.periodLimits ?? {}).map(
                ([period, cap]) =>
                  cap && (
                    <small key={period}>
                      {period}: {cap.spentUsdc} spent + {cap.pendingUsdc} reserved / {cap.limitUsdc}{" "}
                      USDC
                    </small>
                  ),
              )}
            </div>
            <button
              disabled={props.readOnly}
              onClick={() => {
                setSelected(w.id);
                setOpen(true);
              }}
            >
              <SlidersHorizontal size={15} />
              Edit limit
            </button>
          </article>
        ))}
      </div>
      <p className="minimal-note">
        Limits govern permission to spend; they don’t add funds. Existing account approvals and
        agent policies still apply.
      </p>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="reference-dialog abi-workspace-dialog abi-wallet-action-dialog">
          <span className="abi-dialog-symbol" aria-hidden="true">
            <ShieldCheck size={22} />
          </span>
          <DialogTitle>Wallet spending limit</DialogTitle>
          <DialogDescription>
            Choose a wallet, period and the tools its agents can pay for.
          </DialogDescription>
          <WalletLimitEditor
            key={selected}
            {...props}
            initialWalletId={selected}
            onSaved={() => {
              setOpen(false);
              setNotice("Spending limit saved.");
            }}
          />
        </DialogContent>
      </Dialog>
    </section>
  );
}
export function WalletLimitEditor({
  workspaces,
  workspace,
  gFetch,
  onChanged,
  readOnly,
  initialWalletId,
  onSaved,
  cardOnly = false,
}: { initialWalletId?: string; onSaved: () => void; cardOnly?: boolean } & Props) {
  const items = workspaces.filter((w) => w.orgId === workspace.orgId);
  const initial = items.find((w) => w.id === initialWalletId) ?? workspace;
  const [walletId, setWalletId] = useState(initial.id),
    [amount, setAmount] = useState(initial.card.limitUsdc ?? "0"),
    [period, setPeriod] = useState(initial.card.period),
    [periodLimits, setPeriodLimits] = useState<Record<string, string>>(
      Object.fromEntries(
        ["day", "week", "month"].map((p) => [
          p,
          initial.card.periodLimits?.[p as "day"]?.limitUsdc ?? "",
        ]),
      ),
    ),
    [recurring, setRecurring] = useState(initial.card.allowRecurring),
    [allowed, setAllowed] = useState<string[] | null>(initial.card.services ?? null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  function choose(id: string) {
    const w = items.find((x) => x.id === id);
    if (!w) return;
    setWalletId(id);
    setAmount(w.card.limitUsdc ?? "0");
    setPeriod(w.card.period);
    setPeriodLimits(
      Object.fromEntries(
        ["day", "week", "month"].map((p) => [
          p,
          w.card.periodLimits?.[p as "day"]?.limitUsdc ?? "",
        ]),
      ),
    );
    setRecurring(w.card.allowRecurring);
    setAllowed(w.card.services ?? null);
    setError("");
  }
  async function save() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await workspaceJson(
        await gFetch(`/v1/guardian/workspaces/${walletId}/card`, {
          method: "PATCH",
          body: JSON.stringify({
            limitUsdc: amount,
            period,
            allowRecurring: recurring,
            periodLimits: Object.fromEntries(
              Object.entries(periodLimits).map(([p, v]) => [p, v.trim() || null]),
            ),
            services: allowed,
          }),
        }),
      );
      await onChanged();
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="abi-limit-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {!cardOnly && (
        <label>
          Wallet
          <Select value={walletId} onValueChange={choose}>
            <SelectTrigger aria-label="Wallet">
              <Wallet size={17} />
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="abi-access-select">
              {items.map((w) => (
                <SelectItem key={w.id} value={w.id}>
                  {w.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      )}
      <div className="abi-form-columns">
        <label>
          Limit in USDC
          <input
            required
            inputMode="decimal"
            pattern="[0-9]+(\.[0-9]{1,6})?"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label>
          Period
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger aria-label="Period">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="abi-access-select">
              {[
                ["total", "Total (up to 90 days)"],
                ["day", "Per day"],
                ["week", "Per week"],
                ["month", "Per month"],
              ].map(([v, l]) => (
                <SelectItem key={v} value={v}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>
      <fieldset className="abi-period-limits">
        <legend>Additional shared limits · USDC</legend>
        <p className="minimal-note">
          All configured limits apply together. Leave a field empty to remove that additional cap.
          Zero prevents spending.
        </p>
        <div className="abi-form-columns">
          {(["day", "week", "month"] as const).map((p) => (
            <label key={p}>
              {p === "day" ? "Daily" : p === "week" ? "Weekly" : "Monthly"}
              <input
                aria-label={`${p} shared limit`}
                inputMode="decimal"
                pattern="[0-9]+(\.[0-9]{1,6})?"
                value={periodLimits[p]}
                onChange={(e) => setPeriodLimits({ ...periodLimits, [p]: e.target.value })}
              />
            </label>
          ))}
        </div>
      </fieldset>
      <div className="abi-form-field">
        <span>Services</span>
        <ServiceChooser value={allowed} onChange={setAllowed} gFetch={gFetch} />
      </div>
      <h3>Purchase controls</h3>
      <label className="abi-permission-row">
        <span>
          Allow recurring purchases<small>Account controls and approvals still apply.</small>
        </span>
        <input
          type="checkbox"
          checked={recurring}
          onChange={(e) => setRecurring(e.target.checked)}
        />
      </label>
      <p className="minimal-note">
        Calendar periods reset in UTC; weeks start Monday. Pending authorizations continue to
        reserve capacity across resets. Changing a total limit preserves its original start date.
        Connected-service data changes are not supported.
      </p>
      {error && <p role="alert">{error}</p>}
      <Button disabled={busy || readOnly} type="submit">
        {busy ? "Saving…" : "Save spending limit"}
      </Button>
    </form>
  );
}
function ServiceChooser({
  value,
  onChange,
  gFetch,
}: {
  value: string[] | null;
  onChange: (v: string[] | null) => void;
  gFetch: WorkspaceFetcher;
}) {
  const [services, setServices] = useState<Service[]>([]),
    [error, setError] = useState(""),
    [query, setQuery] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    gFetch("/v1/guardian/spending-services")
      .then(workspaceJson)
      .then((d) => {
        if (live) setServices(d.services);
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [gFetch]);
  const providers = [...new Set(services.map((s) => s.providerId))];
  const normalize = (v: string) => {
    try {
      const u = new URL(v);
      return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
    } catch {
      return v;
    }
  };
  const selected = (s: Service) => value === null || value.includes(normalize(s.endpoint));
  function toggle(s: Service, on: boolean) {
    const list = value ?? services.map((x) => normalize(x.endpoint));
    const url = normalize(s.endpoint);
    onChange(on ? [...new Set([...list, url])] : list.filter((x) => x !== url));
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="abi-field-trigger">
          <ShieldCheck size={18} />
          <span>
            {value === null
              ? "All services"
              : `${value.length} enabled ${value.length === 1 ? "tool" : "tools"}`}
          </span>
          <ChevronDown size={17} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="abi-services-popover" align="start">
        <label className="abi-service-all">
          <input
            type="checkbox"
            checked={value === null}
            onChange={(e) => onChange(e.target.checked ? null : [])}
          />
          <span>
            <strong>All services</strong>
            <small>Includes new services as they’re added.</small>
          </span>
        </label>
        <label className="abi-wallet-search">
          <Search size={18} />
          <input
            aria-label="Find a service"
            placeholder="Find a service or tool"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="abi-service-list">
          {loading && <p role="status">Loading published tools…</p>}
          {error && <p role="alert">{error}</p>}
          {!loading && !error && !services.length && (
            <p>
              No published API tools are available to select yet. All services also covers software
              and physical purchases.
            </p>
          )}
          {providers.map((id) => {
            const group = services.filter((s) => s.providerId === id);
            const filtered = group.filter((s) =>
              `${s.provider} ${s.name}`.toLowerCase().includes(query.toLowerCase()),
            );
            if (!filtered.length) return null;
            return (
              <details key={id} open={!!query || undefined}>
                <summary>
                  <span>
                    <strong>{group[0].provider}</strong>
                    <small>
                      {group.length} {group.length === 1 ? "tool" : "tools"} ·{" "}
                      {group.filter(selected).length} enabled
                    </small>
                  </span>
                  <ChevronDown size={16} />
                </summary>
                {filtered.map((s) => (
                  <label key={s.id}>
                    <input
                      type="checkbox"
                      checked={selected(s)}
                      onChange={(e) => toggle(s, e.target.checked)}
                    />
                    <span>{s.name}</span>
                  </label>
                ))}
              </details>
            );
          })}
          {!!query &&
            !services.some((s) =>
              `${s.provider} ${s.name}`.toLowerCase().includes(query.toLowerCase()),
            ) &&
            !loading && <p>No services match this search.</p>}
        </div>
        <p className="minimal-note">
          Selected-tool mode permits payments only to the enabled API endpoints; other purchases are
          blocked.
        </p>
      </PopoverContent>
    </Popover>
  );
}
