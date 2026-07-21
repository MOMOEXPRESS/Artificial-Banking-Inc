"use client";

import { useEffect, useMemo, useState } from "react";
import { PolicySimulator } from "./analytics";
import { Icon, fmtUsd } from "./ui";
import { Button } from "@/components/ui/button";
import { SegTabs } from "@/components/ui/seg-tabs";

/** Live UTC quiet-window status for the Schedule & rules panel. */
function quietWindowStatus(
  quiet: { startHour: number; endHour: number },
  now = new Date(),
): {
  inQuiet: boolean;
  label: string;
  /** 0–1 remaining fraction of the quiet window (1 = just started). */
  remaining: number;
  countdown: string;
  clock: string;
} {
  const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes() + now.getUTCSeconds() / 60;
  const start = quiet.startHour * 60;
  const end = quiet.endHour * 60;
  const clock = now.toISOString().slice(11, 19) + " UTC";
  if (start === end) {
    return { inQuiet: false, label: "Window disabled (start = end)", remaining: 0, countdown: "—", clock };
  }
  const windowLen = start < end ? end - start : 24 * 60 - start + end;
  const inQuiet = start < end ? nowMin >= start && nowMin < end : nowMin >= start || nowMin < end;
  const minsUntil = (target: number) => {
    let d = target - nowMin;
    if (d <= 0) d += 24 * 60;
    return d;
  };
  const fmtDur = (mins: number) => {
    const total = Math.max(0, Math.ceil(mins));
    const h = Math.floor(total / 60);
    const m = total % 60;
    const s = Math.floor((mins % 1) * 60);
    if (h <= 0 && m <= 0) return `${s}s`;
    if (h <= 0) return `${m}m ${String(s).padStart(2, "0")}s`;
    return `${h}h ${String(m).padStart(2, "0")}m`;
  };
  if (inQuiet) {
    const left = minsUntil(end);
    return {
      inQuiet: true,
      label: "Currently in quiet hours",
      remaining: Math.min(1, Math.max(0, left / windowLen)),
      countdown: fmtDur(left),
      clock,
    };
  }
  const untilStart = minsUntil(start);
  return {
    inQuiet: false,
    label: "Outside quiet hours",
    remaining: 0,
    countdown: fmtDur(untilStart),
    clock,
  };
}

export type Policy = {
  perTxMaxUsdc: string;
  dailyMaxUsdc: string;
  hitlAboveUsdc: string;
  maxPaysPerMinute: number;
  newCounterpartyCooldownHours: number;
  addressAllowlist: string[];
  domainAllowlist: string[];
  vendorAllowlist: string[];
  blocklist: string[];
  hitlCategories: string[];
  quietHours?: { startHour: number; endHour: number; action: "review" | "deny" } | null;
  approvalQuorum?: number;
  automation?: {
    id: string;
    name: string;
    createdAt?: string;
    updatedAt?: string;
    when:
      | { kind: "amount_above"; micro: string }
      | { kind: "balance_below"; micro: string; walletId?: string }
      | { kind: "merchant_unknown" }
      | { kind: "budget_exceeded" }
      | { kind: "daily_cap_exceeded" };
    then:
      | { kind: "notify"; channel?: string }
      | { kind: "require_approval" }
      | { kind: "deny" }
      | { kind: "freeze_agent" };
  }[];
};

const HITL_TOOLS = [
  "pay",
  "pay_api",
  "transfer_internal",
  "escrow_lock",
  "escrow_release",
  "escrow_refund",
  "withdraw",
] as const;

/** Editable list of counterparties rendered as removable chips. */
function ListEditor({
  label,
  hint,
  items,
  onChange,
  placeholder,
  tone = "neutral",
}: {
  label: string;
  hint: string;
  items: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  tone?: "neutral" | "bad";
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim().toLowerCase();
    if (!v || items.includes(v)) return setDraft("");
    onChange([...items, v]);
    setDraft("");
  };
  return (
    <div className="field">
      <label>{label}</label>
      <div className="row" style={{ gap: 7, marginBottom: items.length ? 9 : 0 }}>
        <input
          style={{ flex: 1, minWidth: 140 }}
          placeholder={placeholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button variant="ghost" size="sm" disabled={!draft.trim()} onClick={add}>
          <Icon name="plus" size={12} /> Add
        </Button>
      </div>
      <div className="row" style={{ gap: 6 }}>
        {items.map((v) => (
          <span
            key={v}
            className={`pill ${tone === "bad" ? "bad" : "mute"}`}
            style={{ paddingRight: 5 }}
          >
            {v}
            <Button variant="bare"
              style={{ padding: "0 2px", lineHeight: 1, color: "inherit" }}
              onClick={() => onChange(items.filter((x) => x !== v))}
              aria-label={`Remove ${v}`}
            >
              <Icon name="x" size={11} />
            </Button>
          </span>
        ))}
        {!items.length && (
          <span className="faint" style={{ fontSize: 11.5 }}>
            none configured
          </span>
        )}
      </div>
      <div className="hint">{hint}</div>
    </div>
  );
}

/** A limit with a slider, a typed value, and live consequence text. */
function LimitControl({
  label,
  hint,
  value,
  onChange,
  min,
  max,
  step,
  money = true,
  invalid,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  min: number;
  max: number;
  step: number;
  money?: boolean;
  invalid?: string;
}) {
  const n = Number(value) || 0;
  return (
    <div className="field">
      <div className="between" style={{ marginBottom: 7 }}>
        <label style={{ margin: 0 }}>{label}</label>
        <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
          {money && <span className="faint mono">$</span>}
          <input
            style={{ width: 84, textAlign: "right", padding: "5px 8px" }}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      </div>
      <input
        type="range"
        className="slider"
        min={min}
        max={max}
        step={step}
        value={Math.min(Math.max(n, min), max)}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="hint" style={{ color: invalid ? "var(--red)" : undefined }}>
        {invalid ?? hint}
      </div>
    </div>
  );
}

export function PolicyView({
  policy,
  busy,
  act,
  gFetch,
  readOnly = false,
}: {
  policy: Policy;
  busy: boolean;
  act: (label: string, fn: () => Promise<string | void>) => Promise<void>;
  gFetch: (p: string, i?: RequestInit) => Promise<Response>;
  readOnly?: boolean;
}) {
  const locked = busy || readOnly;
  const [f, setF] = useState({
    hitlAboveUsdc: policy.hitlAboveUsdc,
    perTxMaxUsdc: policy.perTxMaxUsdc,
    dailyMaxUsdc: policy.dailyMaxUsdc,
    maxPaysPerMinute: String(policy.maxPaysPerMinute),
    newCounterpartyCooldownHours: String(policy.newCounterpartyCooldownHours ?? 0),
    vendorAllowlist: policy.vendorAllowlist,
    domainAllowlist: policy.domainAllowlist,
    addressAllowlist: policy.addressAllowlist,
    blocklist: policy.blocklist,
    hitlCategories: policy.hitlCategories ?? [],
  });
  const [quiet, setQuiet] = useState(
    policy.quietHours ?? { startHour: 22, endHour: 6, action: "review" as const },
  );
  const [quietOn, setQuietOn] = useState(!!policy.quietHours);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const quietLive = useMemo(
    () => (quietOn ? quietWindowStatus(quiet, new Date(nowTick)) : null),
    [quietOn, quiet, nowTick],
  );
  useEffect(() => {
    if (!quietOn) return;
    const t = window.setInterval(() => setNowTick(Date.now()), 1_000);
    return () => window.clearInterval(t);
  }, [quietOn]);
  const [automation, setAutomation] = useState(policy.automation ?? []);
  const [touched, setTouched] = useState(false);
  const [versions, setVersions] = useState<
    { id: string; version: string; note?: string; createdAt: string; summary?: Record<string, unknown> }[]
  >([]);
  const [templates, setTemplates] = useState<{ id: string; name: string; description: string }[]>([]);
  const [currentVersion, setCurrentVersion] = useState<string>("");
  const [quorum, setQuorum] = useState(policy.approvalQuorum ?? 1);
  const [quorumSeats, setQuorumSeats] = useState(1);
  const [tab, setTab] = useState<"limits" | "allowlists" | "rules" | "governance" | "simulate">(
    "limits",
  );

  useEffect(() => {
    void (async () => {
      const [v, t, q] = await Promise.all([
        gFetch("/v1/guardian/policy/versions").then((r) => r.json()),
        gFetch("/v1/guardian/policy/templates").then((r) => r.json()),
        gFetch("/v1/guardian/quorum").then((r) => r.json()),
      ]);
      setVersions(v.versions ?? []);
      setCurrentVersion(v.current ?? "");
      setTemplates(t.templates ?? []);
      setQuorum(q.approvalQuorum ?? policy.approvalQuorum ?? 1);
      setQuorumSeats(q.seats ?? 1);
    })();
  }, [gFetch, policy]);

  // Adopt server state only while the user has not started editing, so a
  // background poll cannot clobber a half-typed rule change.
  useEffect(() => {
    if (touched) return;
    setF({
      hitlAboveUsdc: policy.hitlAboveUsdc,
      perTxMaxUsdc: policy.perTxMaxUsdc,
      dailyMaxUsdc: policy.dailyMaxUsdc,
      maxPaysPerMinute: String(policy.maxPaysPerMinute),
      newCounterpartyCooldownHours: String(policy.newCounterpartyCooldownHours ?? 0),
      vendorAllowlist: policy.vendorAllowlist,
      domainAllowlist: policy.domainAllowlist,
      addressAllowlist: policy.addressAllowlist,
      blocklist: policy.blocklist,
      hitlCategories: policy.hitlCategories ?? [],
    });
    setQuietOn(!!policy.quietHours);
    if (policy.quietHours) setQuiet(policy.quietHours);
    setAutomation(policy.automation ?? []);
  }, [policy, touched]);

  const set = (k: keyof typeof f) => (v: string | string[]) => {
    setTouched(true);
    setF((p) => ({ ...p, [k]: v }));
  };

  const hitl = Number(f.hitlAboveUsdc) || 0;
  const cap = Number(f.perTxMaxUsdc) || 0;
  const daily = Number(f.dailyMaxUsdc) || 0;
  const bandsInvalid = hitl >= cap;
  const dailyInvalid = daily < cap;
  const noAllowlist = !f.vendorAllowlist.length && !f.domainAllowlist.length;

  const dirty = useMemo(
    () =>
      f.hitlAboveUsdc !== policy.hitlAboveUsdc ||
      f.perTxMaxUsdc !== policy.perTxMaxUsdc ||
      f.dailyMaxUsdc !== policy.dailyMaxUsdc ||
      Number(f.maxPaysPerMinute) !== policy.maxPaysPerMinute ||
      Number(f.newCounterpartyCooldownHours) !== (policy.newCounterpartyCooldownHours ?? 0) ||
      f.vendorAllowlist.join() !== policy.vendorAllowlist.join() ||
      f.domainAllowlist.join() !== policy.domainAllowlist.join() ||
      f.addressAllowlist.join() !== policy.addressAllowlist.join() ||
      f.blocklist.join() !== policy.blocklist.join() ||
      f.hitlCategories.join() !== (policy.hitlCategories ?? []).join() ||
      JSON.stringify(automation) !== JSON.stringify(policy.automation ?? []) ||
      quietOn !== !!policy.quietHours ||
      (quietOn &&
        (quiet.startHour !== policy.quietHours?.startHour ||
          quiet.endHour !== policy.quietHours?.endHour ||
          quiet.action !== policy.quietHours?.action)),
    [f, quiet, quietOn, policy, automation],
  );

  const save = () =>
    act("Policy", async () => {
      const res = await gFetch("/v1/guardian/policy", {
        method: "POST",
        body: JSON.stringify({
          hitlAboveUsdc: f.hitlAboveUsdc,
          perTxMaxUsdc: f.perTxMaxUsdc,
          dailyMaxUsdc: f.dailyMaxUsdc,
          maxPaysPerMinute: Number(f.maxPaysPerMinute) || 1,
          newCounterpartyCooldownHours: Number(f.newCounterpartyCooldownHours) || 0,
          vendorAllowlist: f.vendorAllowlist,
          domainAllowlist: f.domainAllowlist,
          addressAllowlist: f.addressAllowlist,
          blocklist: f.blocklist,
          hitlCategories: f.hitlCategories,
          quietHours: quietOn ? quiet : null,
          automation,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error?.message ?? JSON.stringify(d));
      setTouched(false);
      return "Policy saved — it applies to the very next thing an agent tries.";
    });

  const reset = () => {
    setTouched(false);
    setF({
      hitlAboveUsdc: policy.hitlAboveUsdc,
      perTxMaxUsdc: policy.perTxMaxUsdc,
      dailyMaxUsdc: policy.dailyMaxUsdc,
      maxPaysPerMinute: String(policy.maxPaysPerMinute),
      newCounterpartyCooldownHours: String(policy.newCounterpartyCooldownHours ?? 0),
      vendorAllowlist: policy.vendorAllowlist,
      domainAllowlist: policy.domainAllowlist,
      addressAllowlist: policy.addressAllowlist,
      blocklist: policy.blocklist,
      hitlCategories: policy.hitlCategories ?? [],
    });
    setQuietOn(!!policy.quietHours);
    setAutomation(policy.automation ?? []);
  };

  // Visual band widths, so the three zones read as proportional to real money.
  const scale = Math.max(cap * 1.25, 1);
  const allowPct = Math.max((hitl / scale) * 100, 6);
  const reviewPct = Math.max(((cap - hitl) / scale) * 100, 6);

  return (
    <>
      <div className="card policy-hero">
        <div className="card-head" style={{ marginBottom: 12 }}>
          <div>
            <h2 style={{ margin: 0 }}>Policy</h2>
            <div className="sub">
              How every payment is judged — edit one section at a time, then save.
            </div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            {dirty && (
              <span className="pill warn">
                <i /> unsaved
              </span>
            )}
            {dirty && (
              <Button variant="ghost" size="sm" onClick={reset}>
                Discard
              </Button>
            )}
            <Button
              size="sm"
              disabled={locked || !dirty || bandsInvalid || dailyInvalid}
              onClick={() => void save()}
            >
              Save policy
            </Button>
          </div>
        </div>
        <SegTabs
          value={tab}
          onValueChange={(v) => setTab(v as typeof tab)}
          items={
            [
              { value: "limits", label: "Limits" },
              { value: "allowlists", label: "Allowlists" },
              { value: "rules", label: "Schedule & rules" },
              { value: "governance", label: "Governance" },
              { value: "simulate", label: "Simulate" },
            ] as const
          }
        />
      </div>

      {(bandsInvalid || dailyInvalid || noAllowlist) && (
        <div className="banner" style={{ marginBottom: 4 }}>
          <span className="ico">
            <Icon name="alert" size={16} />
          </span>
          <span className="txt">
            <b>
              {bandsInvalid
                ? "These bands cannot nest"
                : dailyInvalid
                  ? "Daily cap is below the per-payment cap"
                  : "No allowlist configured"}
            </b>
            <span>
              {bandsInvalid
                ? `The approval threshold (${fmtUsd(hitl)}) must be below the per-payment ceiling (${fmtUsd(cap)}), otherwise nothing can ever reach you for approval.`
                : dailyInvalid
                  ? `An agent could never make a single ${fmtUsd(cap)} payment because the day's total is capped at ${fmtUsd(daily)}.`
                  : "With no vendor or domain allowlisted, every pay_api call is refused. Add at least one destination."}
            </span>
          </span>
        </div>
      )}

      {tab === "limits" && (
        <div className="grid g-main fill">
          <div className="card">
            <div className="card-head">
              <div>
                <h2>Judgment bands</h2>
                <div className="sub">Drag a limit and the bands move. Nothing is live until you save.</div>
              </div>
            </div>
            <div className="band-rail">
              <div className="band ok" style={{ flexGrow: allowPct }}>
                <b>Settles instantly</b>
                <span>under {fmtUsd(hitl)}</span>
              </div>
              <div className="band warn" style={{ flexGrow: reviewPct }}>
                <b>Waits for you</b>
                <span>
                  {fmtUsd(hitl)} – {fmtUsd(cap)}
                </span>
              </div>
              <div className="band bad" style={{ flexGrow: 26 }}>
                <b>Always refused</b>
                <span>over {fmtUsd(cap)}</span>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Limits</h2>
            </div>
            <LimitControl
              label="Ask me above"
              hint={`Payments over ${fmtUsd(hitl)} park and wait for your approval.`}
              value={f.hitlAboveUsdc}
              onChange={set("hitlAboveUsdc")}
              min={0}
              max={Math.max(cap, 100)}
              step={0.5}
              invalid={bandsInvalid ? "Must be below the per-payment ceiling." : undefined}
            />
            <LimitControl
              label="Never allow more than"
              hint="A hard ceiling on any single payment — you cannot approve past it."
              value={f.perTxMaxUsdc}
              onChange={set("perTxMaxUsdc")}
              min={1}
              max={500}
              step={1}
            />
            <LimitControl
              label="Daily cap per agent"
              hint="Rolling 24-hour total for each agent individually."
              value={f.dailyMaxUsdc}
              onChange={set("dailyMaxUsdc")}
              min={1}
              max={2000}
              step={5}
              invalid={dailyInvalid ? "Should be at least the per-payment ceiling." : undefined}
            />
            <LimitControl
              label="Max payments per minute"
              hint="Velocity brake — stops a looping agent draining in bursts."
              value={f.maxPaysPerMinute}
              onChange={set("maxPaysPerMinute")}
              min={1}
              max={120}
              step={1}
              money={false}
            />
            <LimitControl
              label="New counterparty cooldown (hours)"
              hint="First payment to an unknown destination parks for approval during this window. 0 disables."
              value={f.newCounterpartyCooldownHours}
              onChange={set("newCounterpartyCooldownHours")}
              min={0}
              max={168}
              step={1}
              money={false}
            />
            <div className="field">
              <label>Always ask me for these tools</label>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                {HITL_TOOLS.map((tool) => {
                  const on = f.hitlCategories.includes(tool);
                  return (
                    <button
                      key={tool}
                      type="button"
                      className={`pill ${on ? "warn" : "mute"}`}
                      onClick={() => {
                        setTouched(true);
                        setF((p) => ({
                          ...p,
                          hitlCategories: on
                            ? p.hitlCategories.filter((t) => t !== tool)
                            : [...p.hitlCategories, tool],
                        }));
                      }}
                    >
                      <i /> {tool}
                    </button>
                  );
                })}
              </div>
              <div className="hint">Category HITL — parks these tools regardless of amount.</div>
            </div>
          </div>
        </div>
      )}

      {tab === "allowlists" && (
        <div className="card">
          <div className="card-head">
            <div>
              <h2>Who agents may pay</h2>
              <div className="sub">Vendors, domains, wallets — and a hard blocklist.</div>
            </div>
          </div>
          <div className="grid g-2">
            <ListEditor
              label="API vendors"
              placeholder="api.openai.com"
              hint="Exact hostnames your agents may buy from."
              items={f.vendorAllowlist}
              onChange={set("vendorAllowlist")}
            />
            <ListEditor
              label="Domains"
              placeholder="yourdomain.com"
              hint="Matches the domain and its subdomains. Dot-anchored, so lookalike domains cannot slip through."
              items={f.domainAllowlist}
              onChange={set("domainAllowlist")}
            />
            <ListEditor
              label="Wallet addresses"
              placeholder="0x…"
              hint="Required for direct transfers. Empty means no direct transfer can ever succeed."
              items={f.addressAllowlist}
              onChange={set("addressAllowlist")}
            />
            <ListEditor
              label="Blocklist"
              placeholder="known-bad.example"
              hint="Always refused, even if allowlisted elsewhere."
              items={f.blocklist}
              onChange={set("blocklist")}
              tone="bad"
            />
          </div>
        </div>
      )}

      {tab === "rules" && (
        <div className="grid g-main fill">
          <div className="card">
            <div className="card-head">
              <div>
                <h2>Quiet hours</h2>
                <div className="sub">
                  Restrict spending overnight, when nobody is watching the console.
                </div>
              </div>
              <button
                className={`switch ${quietOn ? "on" : ""}`}
                onClick={() => {
                  setTouched(true);
                  setQuietOn((v) => !v);
                }}
                aria-label="Toggle quiet hours"
              />
            </div>
            {quietOn && quietLive && (
              <div
                className={`banner ${quietLive.inQuiet ? "warn" : "info"}`}
                style={{ marginBottom: 12 }}
                role="status"
              >
                <span className="txt" style={{ width: "100%" }}>
                  <b style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <Icon name="clock" size={14} />
                    {quietLive.inQuiet ? "Quiet hours active" : "Quiet hours idle"}
                  </b>
                  <span>
                    {quietLive.label} · {quietLive.clock}
                    {quietLive.inQuiet
                      ? ` · ends in ${quietLive.countdown}`
                      : ` · starts in ${quietLive.countdown}`}
                  </span>
                  {quietLive.inQuiet && (
                    <div
                      aria-hidden
                      style={{
                        marginTop: 10,
                        height: 8,
                        borderRadius: 999,
                        background: "var(--border)",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          width: `${Math.round(quietLive.remaining * 100)}%`,
                          background: "var(--yellow, #d4a017)",
                          transition: "width 0.8s linear",
                        }}
                      />
                    </div>
                  )}
                </span>
              </div>
            )}
            {quietOn && (
              <div className="row" style={{ gap: 14, flexWrap: "wrap" }}>
                <div className="field" style={{ margin: 0 }}>
                  <label>From (UTC)</label>
                  <select
                    style={{ width: 110 }}
                    value={quiet.startHour}
                    onChange={(e) => {
                      setTouched(true);
                      setQuiet({ ...quiet, startHour: Number(e.target.value) });
                    }}
                  >
                    {Array.from({ length: 24 }, (_, h) => (
                      <option key={h} value={h}>
                        {String(h).padStart(2, "0")}:00
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Until (UTC)</label>
                  <select
                    style={{ width: 110 }}
                    value={quiet.endHour}
                    onChange={(e) => {
                      setTouched(true);
                      setQuiet({ ...quiet, endHour: Number(e.target.value) });
                    }}
                  >
                    {Array.from({ length: 24 }, (_, h) => (
                      <option key={h} value={h}>
                        {String(h).padStart(2, "0")}:00
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>During those hours</label>
                  <select
                    style={{ width: 190 }}
                    value={quiet.action}
                    onChange={(e) => {
                      setTouched(true);
                      setQuiet({ ...quiet, action: e.target.value as "review" | "deny" });
                    }}
                  >
                    <option value="review">Hold for my approval</option>
                    <option value="deny">Refuse outright</option>
                  </select>
                </div>
                <span className="faint" style={{ fontSize: 11.5, alignSelf: "flex-end", paddingBottom: 8 }}>
                  {quiet.startHour === quiet.endHour
                    ? "Start and end are the same — the window is disabled."
                    : `Covers ${
                        quiet.startHour > quiet.endHour
                          ? 24 - quiet.startHour + quiet.endHour
                          : quiet.endHour - quiet.startHour
                      } hours a day.`}
                </span>
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-head">
              <div>
                <h2>Automation (IF / THEN)</h2>
                <div className="sub">
                  Saved with Policy → Save on this tab. Live rules are listed below. “Require
                  approval” parks under Payments → Approvals.
                </div>
              </div>
              <Button variant="ghost" size="sm"
                onClick={() => {
                  setTouched(true);
                  setAutomation((a) => [
                    ...a,
                    {
                      id: `auto_${Date.now().toString(36)}`,
                      name: "New rule",
                      when: { kind: "merchant_unknown" },
                      then: { kind: "require_approval" },
                    },
                  ]);
                }}
              >
                <Icon name="plus" size={12} /> Add rule
              </Button>
            </div>
            {(policy.automation?.length ?? 0) > 0 && (
              <div
                style={{
                  marginBottom: 14,
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "var(--surface-2)",
                }}
              >
                <div className="muted" style={{ fontSize: 11.5, marginBottom: 6 }}>
                  Currently saved on the org ({policy.automation!.length} rule
                  {policy.automation!.length === 1 ? "" : "s"}) — edits below need Save
                </div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.55 }}>
                  {policy.automation!.map((r) => (
                    <li key={r.id}>
                      <b>{r.name}</b> · when <code>{r.when.kind}</code> →{" "}
                      <code>{r.then.kind}</code>
                      {r.createdAt ? (
                        <span className="faint">
                          {" "}
                          · saved {new Date(r.createdAt).toLocaleString()}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {!automation.length && (
              <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
                No automation rules. Add one to escalate unknown merchants or large payments.
              </p>
            )}
            {automation.map((rule, idx) => (
              <div
                key={rule.id}
                style={{
                  marginBottom: 12,
                  paddingBottom: 12,
                  borderBottom: "1px solid var(--border)",
                }}
              >
              <div
                className="row"
                style={{ gap: 8, flexWrap: "wrap", marginBottom: 6, alignItems: "flex-end" }}
              >
                <div className="field" style={{ margin: 0, minWidth: 120 }}>
                  <label>Name</label>
                  <input
                    value={rule.name}
                    onChange={(e) => {
                      setTouched(true);
                      setAutomation((rows) =>
                        rows.map((r, i) => (i === idx ? { ...r, name: e.target.value } : r)),
                      );
                    }}
                  />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>When</label>
                  <select
                    value={rule.when.kind === "budget_exceeded" ? "daily_cap_exceeded" : rule.when.kind}
                    onChange={(e) => {
                      setTouched(true);
                      const kind = e.target.value;
                      setAutomation((rows) =>
                        rows.map((r, i) => {
                          if (i !== idx) return r;
                          if (kind === "amount_above") {
                            return { ...r, when: { kind: "amount_above", micro: "10000000" } };
                          }
                          if (kind === "balance_below") {
                            return { ...r, when: { kind: "balance_below", micro: "5000000" } };
                          }
                          if (kind === "daily_cap_exceeded" || kind === "budget_exceeded") {
                            return { ...r, when: { kind: "daily_cap_exceeded" } };
                          }
                          return { ...r, when: { kind: "merchant_unknown" } };
                        }),
                      );
                    }}
                  >
                    <option value="merchant_unknown">merchant unknown</option>
                    <option value="daily_cap_exceeded">daily spend cap would exceed</option>
                    <option value="amount_above">amount above (µUSDC)</option>
                    <option value="balance_below">balance below (µUSDC)</option>
                  </select>
                </div>
                {(rule.when.kind === "amount_above" || rule.when.kind === "balance_below") && (
                  <div className="field" style={{ margin: 0, width: 140 }}>
                    <label>Micro</label>
                    <input
                      value={rule.when.micro}
                      onChange={(e) => {
                        setTouched(true);
                        const micro = e.target.value;
                        setAutomation((rows) =>
                          rows.map((r, i) =>
                            i === idx && (r.when.kind === "amount_above" || r.when.kind === "balance_below")
                              ? { ...r, when: { ...r.when, micro } }
                              : r,
                          ),
                        );
                      }}
                    />
                  </div>
                )}
                <div className="field" style={{ margin: 0 }}>
                  <label>Then</label>
                  <select
                    value={rule.then.kind}
                    onChange={(e) => {
                      setTouched(true);
                      const kind = e.target.value as
                        | "notify"
                        | "require_approval"
                        | "deny"
                        | "freeze_agent";
                      setAutomation((rows) =>
                        rows.map((r, i) =>
                          i === idx
                            ? {
                                ...r,
                                then:
                                  kind === "notify"
                                    ? { kind, channel: "in_app" }
                                    : { kind },
                              }
                            : r,
                        ),
                      );
                    }}
                  >
                    <option value="require_approval">require approval</option>
                    <option value="notify">notify</option>
                    <option value="deny">deny</option>
                    <option value="freeze_agent">freeze agent</option>
                  </select>
                </div>
                <Button variant="ghost" size="sm"
                  onClick={() => {
                    setTouched(true);
                    setAutomation((rows) => rows.filter((_, i) => i !== idx));
                  }}
                >
                  Remove
                </Button>
              </div>
              {(rule.createdAt || rule.updatedAt) && (
                <div className="faint" style={{ fontSize: 11, marginTop: 2 }}>
                  {rule.createdAt
                    ? `First saved ${new Date(rule.createdAt).toLocaleString()}`
                    : "Not saved yet"}
                  {rule.updatedAt
                    ? ` · last edit ${new Date(rule.updatedAt).toLocaleString()}`
                    : ""}
                  <span className="mono"> · id {rule.id}</span>
                </div>
              )}
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "governance" && (
        <div className="grid g-2 fill">
          <div className="card">
            <div className="card-head">
              <div>
                <h2>Approval quorum</h2>
                <div className="sub">
                  How many guardians must approve HITL payments · {quorumSeats} eligible seat(s).
                </div>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <input
                  type="number"
                  min={1}
                  max={5}
                  style={{ width: 64 }}
                  disabled={readOnly}
                  value={quorum}
                  onChange={(e) => setQuorum(Number(e.target.value) || 1)}
                />
                <Button size="sm"
                  disabled={locked}
                  onClick={() =>
                    void act("Set quorum", async () => {
                      const res = await gFetch("/v1/guardian/quorum", {
                        method: "POST",
                        body: JSON.stringify({ approvalQuorum: quorum }),
                      });
                      const d = await res.json();
                      if (!res.ok) throw new Error(d.error?.message ?? JSON.stringify(d));
                      return `Quorum set to ${d.approvalQuorum}`;
                    })
                  }
                >
                  Save quorum
                </Button>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <div>
                <h2>Starter templates</h2>
                <div className="sub">Replace active rules (allowlists kept optional).</div>
              </div>
            </div>
            {templates.map((t) => (
              <div key={t.id} className="between" style={{ marginBottom: 10, gap: 8 }}>
                <div>
                  <b style={{ fontSize: 13 }}>{t.name}</b>
                  <div className="faint" style={{ fontSize: 12 }}>{t.description}</div>
                </div>
                <Button variant="ghost" size="sm"
                  disabled={locked}
                  onClick={() =>
                    void act("Apply template", async () => {
                      const res = await gFetch("/v1/guardian/policy/apply-template", {
                        method: "POST",
                        body: JSON.stringify({ templateId: t.id, keepAllowlists: true }),
                      });
                      const d = await res.json();
                      if (!res.ok) throw new Error(d.error?.message ?? JSON.stringify(d.error));
                      setTouched(false);
                      return `Applied ${t.name}.`;
                    })
                  }
                >
                  Apply
                </Button>
              </div>
            ))}
          </div>

          <div className="card" style={{ gridColumn: "1 / -1" }}>
            <div className="card-head">
              <div>
                <h2>Versions</h2>
                <div className="sub">Current pin: {currentVersion || "—"}</div>
              </div>
            </div>
            <div style={{ maxHeight: 280, overflow: "auto" }}>
              {versions.map((v) => (
                <div key={v.id} className="between" style={{ fontSize: 12, padding: "6px 0", gap: 8 }}>
                  <div>
                    <span className="mono">{v.version}</span>
                    {v.note && <span className="faint"> · {v.note}</span>}
                    <div className="faint">{new Date(v.createdAt).toLocaleString()}</div>
                  </div>
                  <Button variant="ghost" size="sm"
                    disabled={locked}
                    onClick={() =>
                      void act("Restore policy", async () => {
                        const res = await gFetch(`/v1/guardian/policy/versions/${v.id}/restore`, {
                          method: "POST",
                        });
                        const d = await res.json();
                        if (!res.ok) throw new Error(JSON.stringify(d.error));
                        setTouched(false);
                        return `Restored ${v.version}.`;
                      })
                    }
                  >
                    Restore
                  </Button>
                </div>
              ))}
              {!versions.length && <div className="faint">No versions yet — save a policy to start history.</div>}
            </div>
          </div>
        </div>
      )}

      {tab === "simulate" && (
        <PolicySimulator
          gFetch={gFetch}
          current={{
            hitlAboveUsdc: policy.hitlAboveUsdc,
            perTxMaxUsdc: policy.perTxMaxUsdc,
            dailyMaxUsdc: policy.dailyMaxUsdc,
            maxPaysPerMinute: policy.maxPaysPerMinute,
            vendorAllowlist: policy.vendorAllowlist,
            domainAllowlist: policy.domainAllowlist,
            addressAllowlist: policy.addressAllowlist,
            blocklist: policy.blocklist,
          }}
          draft={{
            hitlAboveUsdc: f.hitlAboveUsdc,
            perTxMaxUsdc: f.perTxMaxUsdc,
            dailyMaxUsdc: f.dailyMaxUsdc,
            maxPaysPerMinute: f.maxPaysPerMinute,
            vendorAllowlist: f.vendorAllowlist,
            domainAllowlist: f.domainAllowlist,
            addressAllowlist: f.addressAllowlist,
            blocklist: f.blocklist,
            newCounterpartyCooldownHours: f.newCounterpartyCooldownHours,
            quietHours: quietOn ? quiet : null,
          }}
        />
      )}

      {dirty && (
        <div className="save-bar">
          <span>
            <b>Unsaved policy changes.</b> Agents are still being judged by the old rules.
          </span>
          <div className="row">
            <Button variant="ghost" size="sm" onClick={reset}>
              Discard
            </Button>
            <Button size="sm" disabled={locked || bandsInvalid || dailyInvalid} onClick={() => void save()}>
              Save policy
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
