import { useEffect, useMemo, useState } from "react";
import { PolicySimulator } from "./analytics";
import { Icon, fmtUsd } from "./ui";
import { Button } from "@/components/ui/button";
import { SegTabs } from "@/components/ui/seg-tabs";
import { SmoothBarChart } from "./smooth-bar-chart";
import { applyJudgmentBandDrag, formatBandUsd, judgmentScaleMax, MAX_BAND } from "./judgment-bands";

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
  const [automation, setAutomation] = useState(policy.automation ?? []);
  const [touched, setTouched] = useState(false);
  const [versions, setVersions] = useState<
    { id: string; version: string; note?: string; createdAt: string; summary?: Record<string, unknown> }[]
  >([]);
  const [templates, setTemplates] = useState<{ id: string; name: string; description: string }[]>([]);
  const [currentVersion, setCurrentVersion] = useState<string>("");
  const [quorum, setQuorum] = useState(policy.approvalQuorum ?? 1);
  const [quorumSeats, setQuorumSeats] = useState(1);
  const [guardians, setGuardians] = useState<
    {
      id: string;
      name: string;
      role: string;
      revokedAt?: string;
      conditions?: { restricted?: boolean; maxApproveUsdc?: string; note?: string };
    }[]
  >([]);
  const [tab, setTab] = useState<"limits" | "allowlists" | "rules" | "governance" | "simulate">(
    "limits",
  );

  useEffect(() => {
    void (async () => {
      const [v, t, q, g] = await Promise.all([
        gFetch("/v1/guardian/policy/versions").then((r) => r.json()),
        gFetch("/v1/guardian/policy/templates").then((r) => r.json()),
        gFetch("/v1/guardian/quorum").then((r) => r.json()),
        gFetch("/v1/guardian/guardians").then((r) => r.json()),
      ]);
      setVersions(v.versions ?? []);
      setCurrentVersion(v.current ?? "");
      setTemplates(t.templates ?? []);
      setQuorum(q.approvalQuorum ?? policy.approvalQuorum ?? 1);
      setQuorumSeats(q.seats ?? 1);
      setGuardians((g.guardians ?? []).filter((x: { revokedAt?: string }) => !x.revokedAt));
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
                <div className="sub">
                  Same drag bars as Agent spend — linked bands keep the review gap and daily headroom nested as you move them. Nothing is live until you save.
                </div>
              </div>
            </div>
            <SmoothBarChart
              title="Payment judgment"
              hint="Drag · thinner spend-style bars · gaps nest only when needed"
              height={118}
              disabled={locked}
              scaleMax={judgmentScaleMax({ hitl, cap, daily })}
              columns={[
                {
                  id: "hitl",
                  label: "Ask me above",
                  value: hitl,
                  min: 0,
                  max: Math.min(MAX_BAND, Math.max(200, daily * 1.5, cap * 2)),
                  step: 0.5,
                  caption: "review",
                  tone: "warn",
                },
                {
                  id: "cap",
                  label: "Per payment",
                  value: cap,
                  min: 0.5,
                  max: Math.min(MAX_BAND, Math.max(200, daily * 1.5, cap * 2)),
                  step: 0.5,
                  caption: "ceiling",
                  tone: "bad",
                },
                {
                  id: "daily",
                  label: "Daily max",
                  value: daily,
                  min: 0.5,
                  max: Math.min(MAX_BAND, Math.max(400, daily * 1.5, cap * 3)),
                  step: 1,
                  caption: daily >= cap * 2 ? "headroom" : "tight",
                  tone: "ok",
                },
              ]}
              onChange={(id, value) => {
                setTouched(true);
                setF((s) => {
                  const next = applyJudgmentBandDrag(
                    id as "hitl" | "cap" | "daily",
                    value,
                    {
                      hitl: Number(s.hitlAboveUsdc) || 0,
                      cap: Number(s.perTxMaxUsdc) || 0,
                      daily: Number(s.dailyMaxUsdc) || 0,
                    },
                  );
                  return {
                    ...s,
                    hitlAboveUsdc: formatBandUsd(next.hitl),
                    perTxMaxUsdc: formatBandUsd(next.cap),
                    dailyMaxUsdc: formatBandUsd(next.daily),
                  };
                });
              }}
            />
            <div className="band-legend" style={{ marginTop: 14 }}>
              <span>
                <i className="ok" /> Settles instantly under {fmtUsd(hitl)}
              </span>
              <span>
                <i className="warn" /> Waits for you {fmtUsd(hitl)}–{fmtUsd(cap)}
              </span>
              <span>
                <i className="bad" /> Always refused over {fmtUsd(cap)}
              </span>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <div>
                <h2>Pace & cool-down</h2>
                <div className="sub">How fast an agent can fire, and how long a new counterparty waits.</div>
              </div>
            </div>
            <LimitControl
              label="Max payments / minute"
              hint="Burst protection — stops a runaway loop from draining the stipend."
              value={f.maxPaysPerMinute}
              onChange={set("maxPaysPerMinute")}
              min={1}
              max={60}
              step={1}
              money={false}
            />
            <LimitControl
              label="New counterparty cool-down (hours)"
              hint="First payment to a never-seen destination waits this long or needs approval."
              value={f.newCounterpartyCooldownHours}
              onChange={set("newCounterpartyCooldownHours")}
              min={0}
              max={72}
              step={1}
              money={false}
            />
            <div style={{ marginTop: 8 }}>
              <div className="muted" style={{ fontSize: 12.5, marginBottom: 8 }}>
                Always ask me for these tools
              </div>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                {(["pay_api", "pay_address", "x402", "escrow"] as const).map((cat) => {
                  const on = f.hitlCategories.includes(cat);
                  return (
                    <button
                      key={cat}
                      type="button"
                      className={`pill ${on ? "warn" : "mute"}`}
                      disabled={locked}
                      onClick={() => {
                        setTouched(true);
                        setF((s) => ({
                          ...s,
                          hitlCategories: on
                            ? s.hitlCategories.filter((c) => c !== cat)
                            : [...s.hitlCategories, cat],
                        }));
                      }}
                    >
                      <i /> {cat}
                    </button>
                  );
                })}
              </div>
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
            {quietOn && (
              <p className="faint" style={{ fontSize: 12.5, marginBottom: 10, lineHeight: 1.5 }}>
                Live analog clock ticks in the sidebar under <b>Webhooks</b> — it lights up when quiet hours are active.
              </p>
            )}
            {quietOn && (
              <div className="row" style={{ gap: 14, flexWrap: "wrap", marginTop: 14 }}>
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
                      } hours a day. Timer ticks every second.`}
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
          <div className="card" style={{ gridColumn: "1 / -1" }}>
            <div className="card-head">
              <div>
                <h2>Who can approve HITL payments</h2>
                <div className="sub">
                  Pick eligible guardians and how many must agree. Approvers vote on parked payments;
                  viewers can sign in but cannot approve. Restrict an approver to a max amount.
                </div>
              </div>
            </div>

            <div className="gov-seat gov-seat-owner">
              <div>
                <b>Founding owner</b>
                <div className="faint" style={{ fontSize: 12, marginTop: 2 }}>
                  Always eligible · counts as one approval seat
                </div>
              </div>
              <span className="pill ok">
                <i /> approver
              </span>
            </div>

            {guardians.map((g) => {
              const restricted = Boolean(g.conditions?.restricted);
              return (
                <div key={g.id} className="gov-seat">
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <b>{g.name}</b>
                    <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                      <select
                        className="sm"
                        disabled={readOnly}
                        value={g.role === "viewer" ? "viewer" : "approver"}
                        onChange={(e) =>
                          void act("Update guardian", async () => {
                            const role = e.target.value as "approver" | "viewer";
                            const res = await gFetch(`/v1/guardian/guardians/${g.id}`, {
                              method: "PATCH",
                              body: JSON.stringify({ role }),
                            });
                            const d = await res.json();
                            if (!res.ok) throw new Error(d.error?.message ?? "update failed");
                            setGuardians((list) =>
                              list.map((x) => (x.id === g.id ? { ...x, role } : x)),
                            );
                            const q = await gFetch("/v1/guardian/quorum").then((r) => r.json());
                            setQuorumSeats(q.seats ?? 1);
                            return `${g.name} is now ${role}.`;
                          })
                        }
                      >
                        <option value="approver">Can approve</option>
                        <option value="viewer">View only (cannot approve)</option>
                      </select>
                      <label className="row" style={{ gap: 6, fontSize: 12.5 }}>
                        <input
                          type="checkbox"
                          disabled={readOnly || g.role === "viewer"}
                          checked={restricted}
                          onChange={(e) =>
                            void act("Guardian condition", async () => {
                              const next = {
                                restricted: e.target.checked,
                                maxApproveUsdc: g.conditions?.maxApproveUsdc ?? "50",
                                note: g.conditions?.note,
                              };
                              const res = await gFetch(`/v1/guardian/guardians/${g.id}`, {
                                method: "PATCH",
                                body: JSON.stringify({ conditions: next }),
                              });
                              const d = await res.json();
                              if (!res.ok) throw new Error(d.error?.message ?? "update failed");
                              setGuardians((list) =>
                                list.map((x) => (x.id === g.id ? { ...x, conditions: next } : x)),
                              );
                              return e.target.checked
                                ? `${g.name} restricted to max $${next.maxApproveUsdc}.`
                                : `${g.name} unrestricted.`;
                            })
                          }
                        />
                        Restrict amount
                      </label>
                      {restricted && (
                        <input
                          className="sm"
                          style={{ width: 88 }}
                          disabled={readOnly}
                          value={g.conditions?.maxApproveUsdc ?? "50"}
                          onChange={(e) =>
                            setGuardians((list) =>
                              list.map((x) =>
                                x.id === g.id
                                  ? {
                                      ...x,
                                      conditions: {
                                        ...x.conditions,
                                        restricted: true,
                                        maxApproveUsdc: e.target.value,
                                      },
                                    }
                                  : x,
                              ),
                            )
                          }
                          onBlur={() =>
                            void act("Save restriction", async () => {
                              const conditions = {
                                restricted: true,
                                maxApproveUsdc: g.conditions?.maxApproveUsdc ?? "50",
                                note: g.conditions?.note,
                              };
                              const res = await gFetch(`/v1/guardian/guardians/${g.id}`, {
                                method: "PATCH",
                                body: JSON.stringify({ conditions }),
                              });
                              const d = await res.json();
                              if (!res.ok) throw new Error(d.error?.message ?? "update failed");
                              return `Max approve $${conditions.maxApproveUsdc} for ${g.name}.`;
                            })
                          }
                          placeholder="Max $"
                          title="Max USDC this guardian may approve alone"
                        />
                      )}
                    </div>
                  </div>
                  <span className={`pill ${g.role === "viewer" ? "mute" : restricted ? "warn" : "ok"}`}>
                    <i /> {g.role === "viewer" ? "viewer" : restricted ? "restricted" : "approver"}
                  </span>
                </div>
              );
            })}

            {!guardians.length && (
              <p className="muted" style={{ fontSize: 12.5, margin: "8px 0 0" }}>
                No secondary guardians yet — invite them under Settings → Team. The founding owner
                remains the only seat until then.
              </p>
            )}

            <div className="gov-quorum-bar">
              <div>
                <b>Votes required</b>
                <div className="faint" style={{ fontSize: 12, marginTop: 2 }}>
                  Of {quorumSeats} eligible seat{quorumSeats === 1 ? "" : "s"} (owner + approvers)
                </div>
              </div>
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                {Array.from({ length: Math.max(1, quorumSeats) }, (_, i) => i + 1).map((n) => (
                  <Button
                    key={n}
                    size="sm"
                    variant={quorum === n ? "default" : "ghost"}
                    disabled={locked || n > quorumSeats}
                    onClick={() =>
                      void act("Set quorum", async () => {
                        const res = await gFetch("/v1/guardian/quorum", {
                          method: "POST",
                          body: JSON.stringify({ approvalQuorum: n }),
                        });
                        const d = await res.json();
                        if (!res.ok) throw new Error(d.error?.message ?? JSON.stringify(d));
                        setQuorum(d.approvalQuorum);
                        return n === 1
                          ? "Any one eligible guardian can approve."
                          : `${n} eligible guardians must approve.`;
                      })
                    }
                  >
                    {n === 1 ? "Any 1" : `${n} of ${quorumSeats}`}
                  </Button>
                ))}
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

          <div className="card">
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
