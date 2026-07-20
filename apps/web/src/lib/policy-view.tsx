"use client";

import { useEffect, useMemo, useState } from "react";
import { PolicySimulator } from "./analytics";
import { Icon, fmtUsd } from "./ui";

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
        <button className="ghost sm" disabled={!draft.trim()} onClick={add}>
          <Icon name="plus" size={12} /> Add
        </button>
      </div>
      <div className="row" style={{ gap: 6 }}>
        {items.map((v) => (
          <span
            key={v}
            className={`pill ${tone === "bad" ? "bad" : "mute"}`}
            style={{ paddingRight: 5 }}
          >
            {v}
            <button
              className="bare"
              style={{ padding: "0 2px", lineHeight: 1, color: "inherit" }}
              onClick={() => onChange(items.filter((x) => x !== v))}
              aria-label={`Remove ${v}`}
            >
              <Icon name="x" size={11} />
            </button>
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
}: {
  policy: Policy;
  busy: boolean;
  act: (label: string, fn: () => Promise<string | void>) => Promise<void>;
  gFetch: (p: string, i?: RequestInit) => Promise<Response>;
}) {
  const [f, setF] = useState({
    hitlAboveUsdc: policy.hitlAboveUsdc,
    perTxMaxUsdc: policy.perTxMaxUsdc,
    dailyMaxUsdc: policy.dailyMaxUsdc,
    maxPaysPerMinute: String(policy.maxPaysPerMinute),
    vendorAllowlist: policy.vendorAllowlist,
    domainAllowlist: policy.domainAllowlist,
    addressAllowlist: policy.addressAllowlist,
    blocklist: policy.blocklist,
  });
  const [quiet, setQuiet] = useState(
    policy.quietHours ?? { startHour: 22, endHour: 6, action: "review" as const },
  );
  const [quietOn, setQuietOn] = useState(!!policy.quietHours);
  const [touched, setTouched] = useState(false);

  // Adopt server state only while the user has not started editing, so a
  // background poll cannot clobber a half-typed rule change.
  useEffect(() => {
    if (touched) return;
    setF({
      hitlAboveUsdc: policy.hitlAboveUsdc,
      perTxMaxUsdc: policy.perTxMaxUsdc,
      dailyMaxUsdc: policy.dailyMaxUsdc,
      maxPaysPerMinute: String(policy.maxPaysPerMinute),
      vendorAllowlist: policy.vendorAllowlist,
      domainAllowlist: policy.domainAllowlist,
      addressAllowlist: policy.addressAllowlist,
      blocklist: policy.blocklist,
    });
    setQuietOn(!!policy.quietHours);
    if (policy.quietHours) setQuiet(policy.quietHours);
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
      f.vendorAllowlist.join() !== policy.vendorAllowlist.join() ||
      f.domainAllowlist.join() !== policy.domainAllowlist.join() ||
      f.addressAllowlist.join() !== policy.addressAllowlist.join() ||
      f.blocklist.join() !== policy.blocklist.join() ||
      quietOn !== !!policy.quietHours ||
      (quietOn &&
        (quiet.startHour !== policy.quietHours?.startHour ||
          quiet.endHour !== policy.quietHours?.endHour ||
          quiet.action !== policy.quietHours?.action)),
    [f, quiet, quietOn, policy],
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
          vendorAllowlist: f.vendorAllowlist,
          domainAllowlist: f.domainAllowlist,
          addressAllowlist: f.addressAllowlist,
          blocklist: f.blocklist,
          quietHours: quietOn ? quiet : null,
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
      vendorAllowlist: policy.vendorAllowlist,
      domainAllowlist: policy.domainAllowlist,
      addressAllowlist: policy.addressAllowlist,
      blocklist: policy.blocklist,
    });
    setQuietOn(!!policy.quietHours);
  };

  // Visual band widths, so the three zones read as proportional to real money.
  const scale = Math.max(cap * 1.25, 1);
  const allowPct = Math.max((hitl / scale) * 100, 6);
  const reviewPct = Math.max(((cap - hitl) / scale) * 100, 6);

  return (
    <>
      <div className="card">
        <div className="card-head">
          <div>
            <h2>How every payment is judged</h2>
            <div className="sub">
              Drag a limit and the bands below move. Nothing is live until you save.
            </div>
          </div>
          {dirty && (
            <div className="row">
              <span className="pill warn">
                <i /> unsaved changes
              </span>
              <button className="ghost sm" onClick={reset}>
                Discard
              </button>
              <button
                className="sm"
                disabled={busy || bandsInvalid || dailyInvalid}
                onClick={() => void save()}
              >
                Save policy
              </button>
            </div>
          )}
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

        {(bandsInvalid || dailyInvalid || noAllowlist) && (
          <div className="banner" style={{ marginTop: 14 }}>
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
      </div>

      <div className="grid g-2">
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
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Who agents may pay</h2>
          </div>
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

      <PolicySimulator
        gFetch={gFetch}
        current={{
          hitlAboveUsdc: policy.hitlAboveUsdc,
          perTxMaxUsdc: policy.perTxMaxUsdc,
          dailyMaxUsdc: policy.dailyMaxUsdc,
          maxPaysPerMinute: policy.maxPaysPerMinute,
        }}
        draft={{
          hitlAboveUsdc: f.hitlAboveUsdc,
          perTxMaxUsdc: f.perTxMaxUsdc,
          dailyMaxUsdc: f.dailyMaxUsdc,
          maxPaysPerMinute: f.maxPaysPerMinute,
        }}
      />

      {dirty && (
        <div className="save-bar">
          <span>
            <b>Unsaved policy changes.</b> Agents are still being judged by the old rules.
          </span>
          <div className="row">
            <button className="ghost sm" onClick={reset}>
              Discard
            </button>
            <button className="sm" disabled={busy || bandsInvalid || dailyInvalid} onClick={() => void save()}>
              Save policy
            </button>
          </div>
        </div>
      )}
    </>
  );
}
