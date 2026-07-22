"use client";

import { useCallback, useRef, type KeyboardEvent, type PointerEvent } from "react";
import { fmtUsd } from "./ui";

export type SmoothBarColumn = {
  id: string;
  label: string;
  value: number;
  min?: number;
  max?: number;
  /** Snap grain while dragging (default 0.5). */
  step?: number;
  caption?: string;
  /** Visual tone for the filled bar. */
  tone?: "default" | "ok" | "warn" | "bad";
};

/**
 * Overview-style vertical bars you drag smoothly (pointer capture),
 * not click-jump. Shared by Ops auto-fund and Policy limits.
 */
export function SmoothBarChart({
  columns,
  scaleMax,
  disabled,
  height = 180,
  onChange,
  hint = "Drag a column up or down",
  title = "Levels",
}: {
  columns: SmoothBarColumn[];
  /** Shared chart ceiling — defaults to 1.15× tallest column (floored at 50). */
  scaleMax?: number;
  disabled?: boolean;
  height?: number;
  onChange: (id: string, value: number) => void;
  hint?: string;
  title?: string;
}) {
  const trackRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const dragging = useRef<string | null>(null);

  const autoScale = Math.max(...columns.map((c) => c.value), 50) * 1.15;
  const scale = Math.max(scaleMax ?? autoScale, 1);
  const peakIdx = columns.reduce(
    (best, c, i) => (c.value > (columns[best]?.value ?? -1) ? i : best),
    0,
  );

  const valueFromY = useCallback(
    (col: SmoothBarColumn, clientY: number) => {
      const el = trackRefs.current[col.id];
      if (!el) return col.value;
      const rect = el.getBoundingClientRect();
      const pct = 1 - Math.min(1, Math.max(0, (clientY - rect.top) / Math.max(rect.height, 1)));
      const lo = col.min ?? 0;
      const hi = col.max ?? scale;
      const step = col.step ?? 0.5;
      const raw = lo + pct * (hi - lo);
      const snapped = Math.round(raw / step) * step;
      return Math.min(hi, Math.max(lo, Number(snapped.toFixed(2))));
    },
    [scale],
  );

  const onPointerDown = (col: SmoothBarColumn, e: PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.preventDefault();
    dragging.current = col.id;
    e.currentTarget.setPointerCapture(e.pointerId);
    onChange(col.id, valueFromY(col, e.clientY));
  };

  const onPointerMove = (col: SmoothBarColumn, e: PointerEvent<HTMLDivElement>) => {
    if (disabled || dragging.current !== col.id) return;
    onChange(col.id, valueFromY(col, e.clientY));
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    dragging.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  };

  const onKey = (col: SmoothBarColumn, e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const step = (col.step ?? 0.5) * (e.shiftKey ? 10 : 1);
    const lo = col.min ?? 0;
    const hi = col.max ?? scale;
    if (e.key === "ArrowUp" || e.key === "ArrowRight") {
      e.preventDefault();
      onChange(col.id, Math.min(hi, Number((col.value + step).toFixed(2))));
    } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
      e.preventDefault();
      onChange(col.id, Math.max(lo, Number((col.value - step).toFixed(2))));
    } else if (e.key === "Home") {
      e.preventDefault();
      onChange(col.id, lo);
    } else if (e.key === "End") {
      e.preventDefault();
      onChange(col.id, hi);
    }
  };

  return (
    <div className={`smooth-bars ${disabled ? "is-disabled" : ""}`}>
      <div className="smooth-bars-head">
        <span className="muted" style={{ fontSize: 12.5 }}>
          {title}
        </span>
        <span className="faint" style={{ fontSize: 11.5 }}>
          {hint}
        </span>
      </div>
      <div className="smooth-bars-row" style={{ height }}>
        {columns.map((c, i) => {
          const lo = c.min ?? 0;
          const hi = c.max ?? scale;
          const span = Math.max(hi - lo, 0.0001);
          const pct = Math.max(((c.value - lo) / span) * 100, c.value > lo ? 5 : 2);
          const on = i === peakIdx;
          return (
            <div
              className={`bar-col ${on ? "on" : ""} tone-${c.tone ?? "default"}`}
              key={c.id}
            >
              <div
                className="bar-track"
                ref={(el) => {
                  trackRefs.current[c.id] = el;
                }}
                role="slider"
                tabIndex={disabled ? -1 : 0}
                aria-valuemin={lo}
                aria-valuemax={hi}
                aria-valuenow={c.value}
                aria-label={c.label}
                title={`${c.label}: ${fmtUsd(c.value)} — drag to set`}
                onPointerDown={(e) => onPointerDown(c, e)}
                onPointerMove={(e) => onPointerMove(c, e)}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onKeyDown={(e) => onKey(c, e)}
              >
                <div
                  className="bar-fill"
                  style={{
                    height: `${pct}%`,
                    transition: dragging.current === c.id ? "none" : "height 0.12s ease-out",
                  }}
                >
                  {on && c.caption ? <span className="bar-tag">{c.caption}</span> : null}
                  <span className="bar-val">{fmtUsd(c.value, c.value < 100 ? 2 : 0)}</span>
                </div>
              </div>
              <div className="bar-x">{c.label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
