"use client";

import { useEffect, useMemo, useState } from "react";

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
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      setNow(new Date());
    };
    const t = window.setInterval(tick, 1000);
    return () => window.clearInterval(t);
  }, []);

  const enabled = Boolean(quiet) && quiet!.startHour !== quiet!.endHour;
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

  return (
    <button
      type="button"
      className={`rail-clock ${status?.inQuiet ? "is-quiet" : ""} ${enabled ? "" : "is-off"}`}
      onClick={onOpenPolicy}
      title={
        enabled
          ? status?.inQuiet
            ? `Quiet hours active · ends in ${status.countdown}`
            : `Open · quiet starts in ${status?.countdown ?? "—"}`
          : "Quiet hours off — open Policy to enable"
      }
    >
      <svg className="rail-clock-face" viewBox="0 0 64 64" aria-hidden>
        <circle className="rail-clock-disk" cx="32" cy="32" r="29" />
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
        <line
          className="rail-clock-hand hour"
          x1="32"
          y1="32"
          x2="32"
          y2="18"
          transform={`rotate(${hourDeg} 32 32)`}
        />
        <line
          className="rail-clock-hand minute"
          x1="32"
          y1="32"
          x2="32"
          y2="12"
          transform={`rotate(${minDeg} 32 32)`}
        />
        <line
          className="rail-clock-hand second"
          x1="32"
          y1="34"
          x2="32"
          y2="10"
          transform={`rotate(${secDeg} 32 32)`}
        />
        <circle className="rail-clock-hub" cx="32" cy="32" r="2.2" />
      </svg>
      <span className="rail-clock-meta">
        <b>{enabled ? (status?.inQuiet ? "Quiet" : "Open") : "Clock"}</b>
        <span className="mono">{now.toISOString().slice(11, 19)} UTC</span>
      </span>
    </button>
  );
}
