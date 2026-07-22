"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

/* ============================================================== formatters */

export const fmtUsd = (v: string | number | undefined, dp = 2) => {
  if (v === undefined || v === null || v === "") return "—";
  const n = typeof v === "number" ? v : Number(v);
  if (Number.isNaN(n)) return String(v);
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
};

export const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });

export const relTime = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.round(diff / 1000);
  if (Math.abs(s) < 60) return `${s < 0 ? "in " : ""}${Math.abs(s)}s${s < 0 ? "" : " ago"}`;
  const m = Math.round(s / 60);
  if (Math.abs(m) < 60) return `${m < 0 ? "in " : ""}${Math.abs(m)}m${m < 0 ? "" : " ago"}`;
  const h = Math.round(m / 60);
  if (Math.abs(h) < 24) return `${h < 0 ? "in " : ""}${Math.abs(h)}h${h < 0 ? "" : " ago"}`;
  return fmtDate(iso);
};

/* =================================================================== icons */

const PATHS: Record<string, ReactNode> = {
  home: (
    <>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5.5 9.5V20a1 1 0 0 0 1 1H9.5v-5.5h5V21h3a1 1 0 0 0 1-1V9.5" />
    </>
  ),
  play: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M10 8.5 16 12l-6 3.5v-7z" />
    </>
  ),
  check: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12 2.4 2.4L15.5 9.5" />
    </>
  ),
  swap: (
    <>
      <path d="M16 3.5 20 7l-4 3.5M20 7H6" />
      <path d="M8 20.5 4 17l4-3.5M4 17h14" />
    </>
  ),
  book: (
    <>
      <path d="M4 5a2.5 2.5 0 0 1 2.5-2.5H20v16.5H6.5A2.5 2.5 0 0 0 4 21.5V5z" />
      <path d="M4 5v16.5" />
      <path d="M8 7.5h7M8 11h4.5" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 7h9M18.5 7H20M4 12h2.5M12 12h8M4 17h6.5M16 17h4" />
      <circle cx="15.5" cy="7" r="2" />
      <circle cx="9" cy="12" r="2" />
      <circle cx="13" cy="17" r="2" />
    </>
  ),
  zap: <path d="M13 2.5 5 13.5h6L10.5 21.5 19 10.5h-6L13 2.5z" />,
  list: (
    <>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <circle cx="4.6" cy="6" r="1.1" />
      <circle cx="4.6" cy="12" r="1.1" />
      <circle cx="4.6" cy="18" r="1.1" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 14.5a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5v.2a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1h.2a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />
    </>
  ),
  bell: (
    <>
      <path d="M18 8.5a6 6 0 1 0-12 0c0 6-2.5 7.5-2.5 7.5h17S18 14.5 18 8.5z" />
      <path d="M13.7 20a2 2 0 0 1-3.4 0" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  logout: (
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 16 5-4-5-4M21 12H9" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  spark: (
    <>
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
      <circle cx="12" cy="12" r="3.2" />
    </>
  ),
  shield: (
    <>
      <path d="M12 2.5 4.5 5.8v6c0 4.9 3.3 8.4 7.5 10.2 4.2-1.8 7.5-5.3 7.5-10.2v-6L12 2.5z" />
      <path d="m9.2 12 2 2 3.6-4" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3.5 2.5 20h19L12 3.5z" />
      <path d="M12 10v4.5M12 17.6v.1" />
    </>
  ),
  inbox: (
    <>
      <path d="M22 12.5h-5.5l-1.7 2.7H9.2l-1.7-2.7H2" />
      <path d="M5.7 4.8h12.6L22 12.5V18a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-5.5l3.7-7.7z" />
    </>
  ),
  arrowRight: <path d="M5 12h13m-5-5 5 5-5 5" />,
  arrowLeft: <path d="M19 12H6m5-5-5 5 5 5" />,
  chevronDown: <path d="M6 9.5 12 15.5 18 9.5" />,
  chevronRight: <path d="M9.5 6 15.5 12 9.5 18" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  wallet: (
    <>
      <path d="M3 8.5A2.5 2.5 0 0 1 5.5 6H19a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5.5A2.5 2.5 0 0 1 3 16.5v-8z" />
      <path d="M3 8.5h18M16.5 12.5h1.5" />
    </>
  ),
  robot: (
    <>
      <rect x="4" y="8" width="16" height="12" rx="3" />
      <path d="M12 4.5V8M9.5 13.5v1M14.5 13.5v1M9 17.5h6" />
      <circle cx="12" cy="3.4" r="1.3" />
    </>
  ),
  external: <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />,
  download: <path d="M12 3.5v11m0 0 4-4m-4 4-4-4M4 18.5v1a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1" />,
  send: <path d="M21.5 3.5 2.5 10.8l7.3 2.9 2.9 7.3 8.8-17.5zM9.8 13.7l4.6-4.6" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5.2l3.3 2" />
    </>
  ),
  vault: (
    <>
      <rect x="4" y="8" width="16" height="12" rx="2.5" />
      <path d="M8 8V6.5a4 4 0 0 1 8 0V8" />
      <circle cx="12" cy="14" r="1.6" />
    </>
  ),
  layers: (
    <>
      <path d="M12 3.5 3.5 8 12 12.5 20.5 8 12 3.5z" />
      <path d="M3.5 12 12 16.5 20.5 12" />
      <path d="M3.5 16 12 20.5 20.5 16" />
    </>
  ),
  chart: (
    <>
      <path d="M4 19.5h16" />
      <path d="M7 16.5V11M12 16.5V7.5M17 16.5v-3.5" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="14" r="3.5" />
      <path d="M11 12.5h9.5v3H17v2h-2.5v-2H14" />
    </>
  ),
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
      <path d="M6.5 15.5H5.5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" />
    </>
  ),
};

export function Icon({ name, size }: { name: string; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      width={size}
      height={size}
      aria-hidden
    >
      {PATHS[name] ?? PATHS.list}
    </svg>
  );
}

/* =================================================================== charts */

export function BarChart({
  data,
  highlightIndex,
  yTicks = 5,
}: {
  data: { label: string; value: number; caption?: string }[];
  highlightIndex?: number;
  yTicks?: number;
}) {
  // The console re-polls every few seconds, handing this component a fresh
  // array each time. Without a value-based key the bars remount and replay
  // their grow animation on every poll, which reads as a flicker/lag. Keying
  // on the actual values means identical data renders identically — the
  // animation only replays when the numbers really changed.
  const sig = useMemo(() => data.map((d) => `${d.label}:${d.value}`).join("|"), [data]);
  const max = Math.max(...data.map((d) => d.value), 1);
  const top = Math.ceil(max * 1.18);
  const ticks = Array.from({ length: yTicks }, (_, i) =>
    Math.round((top / (yTicks - 1)) * (yTicks - 1 - i)),
  );
  return (
    <div style={{ display: "flex", gap: 10, height: "100%", minHeight: 210 }}>
      <div className="chart-y">
        {ticks.map((t) => (
          <div key={t}>{t >= 1000 ? `${(t / 1000).toFixed(t % 1000 ? 1 : 0)}k` : t}</div>
        ))}
      </div>
      <div className="bars" key={sig}>
        {data.map((d, i) => {
          const pct = Math.max((d.value / top) * 100, d.value > 0 ? 4 : 1.5);
          const on = i === highlightIndex;
          return (
            <div className={`bar-col ${on ? "on" : ""}`} key={`${i}:${d.value}`}>
              <div className="bar-track" title={`${d.label}: ${fmtUsd(d.value)}`}>
                <div
                  className="bar-fill"
                  style={{ height: `${pct}%`, animationDelay: `${i * 34}ms` }}
                >
                  {on && d.caption && <span className="bar-tag">{d.caption}</span>}
                  {on && <span className="bar-val">{fmtUsd(d.value, d.value < 100 ? 2 : 0)}</span>}
                </div>
              </div>
              <div className="bar-x">{d.label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function Donut({
  slices,
  total,
  caption,
}: {
  slices: { label: string; value: number; color: string }[];
  total: string;
  caption: string;
}) {
  const sum = slices.reduce((a, s) => a + s.value, 0) || 1;
  const R = 66;
  const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div className="donut">
      <svg width="168" height="168" viewBox="0 0 168 168">
        <circle cx="84" cy="84" r={R} fill="none" stroke="#232329" strokeWidth="21" />
        {slices.map((s, i) => {
          const frac = s.value / sum;
          const len = frac * C;
          const el = (
            <circle
              key={s.label}
              cx="84"
              cy="84"
              r={R}
              fill="none"
              stroke={s.color}
              strokeWidth={21}
              strokeDasharray={`${Math.max(len - 3, 0)} ${C - Math.max(len - 3, 0)}`}
              strokeDashoffset={-offset}
              strokeLinecap="round"
              style={
                {
                  "--dash-len": `${C}px`,
                  animationDelay: `${i * 70}ms`,
                } as React.CSSProperties
              }
            >
              <title>{`${s.label}: ${fmtUsd(s.value)} (${Math.round(frac * 100)}%)`}</title>
            </circle>
          );
          offset += len;
          return el;
        })}
      </svg>
      <div className="center">
        <div>
          <b>{total}</b>
          <span>{caption}</span>
        </div>
      </div>
    </div>
  );
}

export function Sparkline({ values, highlightLast = true }: { values: number[]; highlightLast?: boolean }) {
  const max = Math.max(...values, 1);
  return (
    <div className="spark">
      {values.map((v, i) => (
        <i
          key={i}
          className={highlightLast && i === values.length - 1 ? "on" : ""}
          style={{ height: `${Math.max((v / max) * 100, 6)}%` }}
        />
      ))}
    </div>
  );
}

export function Calendar({ marks }: { marks: string[] }) {
  // Offset in months from the current month, so the arrows actually navigate.
  const [offset, setOffset] = useState(0);
  const now = new Date();
  const cursor = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  // "Today" only exists on the current month's page.
  const today = offset === 0 ? now.getDate() : -1;
  const first = new Date(year, month, 1);
  const startPad = (first.getDay() + 6) % 7; // Monday-first
  const days = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array.from({ length: startPad }, () => null),
    ...Array.from({ length: days }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const markSet = useMemo(() => new Set(marks), [marks]);
  return (
    <>
      <div className="between" style={{ marginBottom: 14 }}>
        <button
          className="round"
          aria-label="Previous month"
          onClick={() => setOffset((o) => o - 1)}
        >
          <span style={{ display: "grid", placeItems: "center", transform: "rotate(180deg)" }}>
            <Icon name="arrowRight" />
          </span>
        </button>
        <Button variant="bare"
          onClick={() => setOffset(0)}
          title={offset === 0 ? "Current month" : "Back to this month"}
          style={{ fontSize: 14.5, fontWeight: 600, color: "var(--text)" }}
        >
          {first.toLocaleDateString([], { month: "long", year: "numeric" })}
        </Button>
        <button
          className="round"
          aria-label="Next month"
          disabled={offset >= 0}
          onClick={() => setOffset((o) => o + 1)}
        >
          <Icon name="arrowRight" />
        </button>
      </div>
      <div className="cal">
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
          <div className="dow" key={i}>
            {d}
          </div>
        ))}
        {cells.map((d, i) => {
          const key =
            d === null
              ? ""
              : `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
          const active = d !== null && markSet.has(key);
          // Past days with no agent activity get the etched-line treatment.
          const quiet = d !== null && !active && d < today;
          return (
            <div
              key={i}
              className={`day ${d === null ? "pad" : ""} ${d === today ? "today" : ""} ${quiet ? "quiet" : ""}`}
              title={
                d
                  ? `${d} ${first.toLocaleDateString([], { month: "short" })}${active ? " · agent activity" : quiet ? " · no activity" : ""}`
                  : undefined
              }
            >
              {d ?? "0"}
              {active && <span className="evt" />}
            </div>
          );
        })}
      </div>
    </>
  );
}

export function Meter({ score, of = 100 }: { score: number; of?: number }) {
  const segs = 40;
  const on = Math.round((score / of) * segs);
  return (
    <div className="meter">
      {Array.from({ length: segs }, (_, i) => (
        <i key={i} className={i < on ? "on" : ""} />
      ))}
    </div>
  );
}

export function BarLine({ value, max }: { value: number; max: number }) {
  const pct = Math.min(100, (value / Math.max(max, 0.000001)) * 100);
  return (
    <div className="bar-line" title={`${fmtUsd(value)} of ${fmtUsd(max)}`}>
      <span className={pct >= 100 ? "full" : pct >= 75 ? "hot" : ""} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Empty({
  icon = "inbox",
  children,
  action,
}: {
  icon?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty empty-rich">
      <div className="empty-art" aria-hidden>
        <svg viewBox="0 0 120 80" width="96" height="64" fill="none">
          <rect x="8" y="18" width="104" height="52" rx="2" stroke="currentColor" strokeWidth="2" opacity="0.35" />
          <path d="M8 34h104" stroke="currentColor" strokeWidth="2" opacity="0.25" />
          <circle cx="22" cy="26" r="3" fill="currentColor" opacity="0.4" />
          <circle cx="34" cy="26" r="3" fill="currentColor" opacity="0.4" />
          <circle cx="46" cy="26" r="3" fill="currentColor" opacity="0.4" />
          <rect x="28" y="44" width="64" height="8" rx="1" fill="currentColor" opacity="0.12" />
          <rect x="40" y="56" width="40" height="6" rx="1" fill="currentColor" opacity="0.08" />
        </svg>
        <span className="empty-icon">
          <Icon name={icon} />
        </span>
      </div>
      <div className="empty-body">{children}</div>
      {action ? <div className="empty-action">{action}</div> : null}
    </div>
  );
}

export function Stat({
  label,
  value,
  foot,
  delta,
}: {
  label: string;
  value: string;
  foot?: ReactNode;
  delta?: { dir: "up" | "down" | "flat"; text: string };
}) {
  return (
    <div className="card kpi">
      <div className="label">{label}</div>
      <div className="row" style={{ gap: 9 }}>
        <div className="value">{value}</div>
        {delta && (
          <span className={`delta ${delta.dir}`}>
            {delta.dir === "up" ? "▲" : delta.dir === "down" ? "▼" : "●"} {delta.text}
          </span>
        )}
      </div>
      {foot && <div className="foot">{foot}</div>}
    </div>
  );
}
