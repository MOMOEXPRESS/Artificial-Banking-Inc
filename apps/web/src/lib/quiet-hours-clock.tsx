"use client";

import { useEffect, useId, useMemo, useState } from "react";

export type QuietHoursConfig = {
  startHour: number;
  endHour: number;
  action?: "review" | "deny";
};

export function quietWindowStatus(
  quiet: { startHour: number; endHour: number },
  now = new Date(),
): {
  inQuiet: boolean;
  label: string;
  progress: number;
  timer: string;
  countdown: string;
  clock: string;
} {
  const nowSec =
    now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds();
  const startSec = quiet.startHour * 3600;
  const endSec = quiet.endHour * 3600;
  const day = 24 * 3600;
  const clock = now.toISOString().slice(11, 19) + " UTC";
  if (startSec === endSec) {
    return {
      inQuiet: false,
      label: "Window disabled",
      progress: 0,
      timer: "—:—:—",
      countdown: "—",
      clock,
    };
  }
  const windowLen = startSec < endSec ? endSec - startSec : day - startSec + endSec;
  const waitLen = day - windowLen;
  const inQuiet =
    startSec < endSec
      ? nowSec >= startSec && nowSec < endSec
      : nowSec >= startSec || nowSec < endSec;
  const secsUntil = (target: number) => {
    let d = target - nowSec;
    if (d <= 0) d += day;
    return d;
  };
  const split = (totalSec: number) => {
    const s = Math.max(0, Math.floor(totalSec));
    const hours = Math.floor(s / 3600);
    const minutes = Math.floor((s % 3600) / 60);
    const seconds = s % 60;
    const timer = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    const countdown =
      hours > 0
        ? `${hours}h ${String(minutes).padStart(2, "0")}m`
        : minutes > 0
          ? `${minutes}m ${String(seconds).padStart(2, "0")}s`
          : `${seconds}s`;
    return { timer, countdown };
  };
  if (inQuiet) {
    const left = secsUntil(endSec);
    return {
      inQuiet: true,
      label: "Quiet hours",
      progress: Math.min(1, Math.max(0, 1 - left / windowLen)),
      clock,
      ...split(left),
    };
  }
  const untilStart = secsUntil(startSec);
  return {
    inQuiet: false,
    label: "Open hours",
    progress: Math.min(1, Math.max(0, 1 - untilStart / Math.max(1, waitLen))),
    clock,
    ...split(untilStart),
  };
}

/** Build an SVG arc path for a quiet window on a 12h-style dial (0h=12 o'clock). */
function quietArcPath(startHour: number, endHour: number, r = 22): string {
  const toXY = (hour: number) => {
    // Map 24h onto 360° with 0 UTC at top (same as analog face for 12h clock feel:
    // use hour % 12 so a full quiet overnight still paints a visible wedge).
    const deg = ((hour % 12) / 12) * 360 - 90;
    const a = (deg * Math.PI) / 180;
    return { x: 32 + Math.cos(a) * r, y: 32 + Math.sin(a) * r };
  };
  let span = endHour - startHour;
  if (span <= 0) span += 24;
  // Cap visual span to 12h of dial so wedge stays readable on 12-tick face
  const visualSpan = Math.min(span, 12);
  const start = toXY(startHour);
  const end = toXY(startHour + visualSpan);
  const large = visualSpan > 6 ? 1 : 0;
  return `M 32 32 L ${start.x} ${start.y} A ${r} ${r} 0 ${large} 1 ${end.x} ${end.y} Z`;
}

/**
 * Compact analog UTC clock for the console rail — ticks every second and
 * lights up when the org is inside quiet hours.
 */
export function RailQuietClock({
  quiet,
  onOpenPolicy,
}: {
  quiet: QuietHoursConfig | null | undefined;
  onOpenPolicy?: () => void;
}) {
  const clipId = useId().replace(/:/g, "");
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      setNow(new Date());
    };
    // Seconds matter inside quiet hours; otherwise a slower tick is enough.
    const ms = quiet && quiet.startHour !== quiet.endHour ? 1000 : 15_000;
    const t = window.setInterval(tick, ms);
    return () => window.clearInterval(t);
  }, [quiet]);

  const enabled = Boolean(quiet) && quiet!.startHour !== quiet!.endHour;
  const action = quiet?.action ?? "review";
  const status = useMemo(
    () => (enabled && quiet ? quietWindowStatus(quiet, now) : null),
    [enabled, quiet, now],
  );

  const h = now.getUTCHours() % 12;
  const m = now.getUTCMinutes();
  const s = now.getUTCSeconds();
  const secDeg = s * 6;
  const minDeg = m * 6 + s * 0.1;
  const hourDeg = h * 30 + m * 0.5;

  const inQuiet = Boolean(status?.inQuiet);
  const denyMode = action === "deny";

  return (
    <button
      type="button"
      className={[
        "rail-clock",
        inQuiet ? "is-quiet" : "",
        inQuiet && denyMode ? "is-deny" : "",
        enabled ? "" : "is-off",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={onOpenPolicy}
      title={
        enabled
          ? inQuiet
            ? `Quiet hours active · ends in ${status!.countdown} · payments → ${action}`
            : `Open · quiet starts in ${status?.countdown ?? "—"} · on hit → ${action}`
          : "Quiet hours off — open Policy to enable"
      }
    >
      <svg className="rail-clock-face" viewBox="0 0 64 64" aria-hidden>
        <defs>
          <clipPath id={`rail-clock-clip-${clipId}`}>
            <circle cx="32" cy="32" r="28" />
          </clipPath>
        </defs>
        <circle className="rail-clock-disk" cx="32" cy="32" r="29" />
        {enabled && quiet && (
          <path
            className={`rail-clock-window ${inQuiet ? "active" : ""}`}
            d={quietArcPath(quiet.startHour, quiet.endHour)}
          />
        )}
        <circle className="rail-clock-rim" cx="32" cy="32" r="29" />
        {Array.from({ length: 12 }).map((_, i) => {
          const a = ((i * 30 - 90) * Math.PI) / 180;
          const x1 = 32 + Math.cos(a) * 24;
          const y1 = 32 + Math.sin(a) * 24;
          const x2 = 32 + Math.cos(a) * 27;
          const y2 = 32 + Math.sin(a) * 27;
          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              className="rail-clock-tick"
            />
          );
        })}
        <g clipPath={`url(#rail-clock-clip-${clipId})`}>
          <g transform={`rotate(${hourDeg} 32 32)`}>
            <line className="rail-clock-hand hour" x1="32" y1="32" x2="32" y2="19.5" />
          </g>
          <g transform={`rotate(${minDeg} 32 32)`}>
            <line className="rail-clock-hand minute" x1="32" y1="32" x2="32" y2="13" />
          </g>
          <g transform={`rotate(${secDeg} 32 32)`}>
            <line className="rail-clock-hand second" x1="32" y1="33.5" x2="32" y2="11.5" />
          </g>
        </g>
        <circle className="rail-clock-hub" cx="32" cy="32" r="2.2" />
      </svg>
      <span className="rail-clock-meta">
        <b>
          {!enabled
            ? "Clock"
            : inQuiet
              ? denyMode
                ? "Quiet · deny"
                : "Quiet · hold"
              : "Open"}
        </b>
        <span className="mono">
          {enabled && status
            ? inQuiet
              ? `ends ${status.countdown}`
              : `quiet in ${status.countdown}`
            : `${now.toISOString().slice(11, 19)} UTC`}
        </span>
        {enabled && (
          <span className="rail-clock-utc mono">{now.toISOString().slice(11, 19)} UTC</span>
        )}
      </span>
    </button>
  );
}
