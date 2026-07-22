/**
 * Autonomous judgment-band nesting — dynamic gaps and daily headroom.
 *
 * Goals while dragging one column:
 * - Keep allow < review < deny (hitl + gap ≤ cap ≤ daily)
 * - Preserve the guardian’s intended review gap when possible
 * - Keep a sensible daily/cap ratio (headroom) so daily isn’t stuck at 1× ceiling
 * - Expand the workable ceiling when the user pushes toward the top of the scale
 */

export type JudgmentBands = {
  hitl: number;
  cap: number;
  daily: number;
};

const MIN_GAP = 0.5;
const MIN_CAP = 0.5;
/** Preferred daily headroom multiple of per-payment when lifting daily with cap. */
const HEADROOM = 2.5;

function roundStep(n: number, step = 0.5): number {
  return Math.round(n / step) * step;
}

function preserveGap(hitl: number, cap: number): number {
  const raw = cap - hitl;
  if (!Number.isFinite(raw) || raw <= 0) return Math.max(MIN_GAP, roundStep(cap * 0.25) || MIN_GAP);
  return Math.max(MIN_GAP, roundStep(raw));
}

function preserveRatio(cap: number, daily: number): number {
  if (!Number.isFinite(cap) || cap <= 0) return HEADROOM;
  if (!Number.isFinite(daily) || daily < cap) return HEADROOM;
  return Math.max(1, daily / cap);
}

/**
 * Apply a single-column drag. Returns a fully nested { hitl, cap, daily }.
 */
export function applyJudgmentBandDrag(
  id: "hitl" | "cap" | "daily",
  value: number,
  prev: JudgmentBands,
): JudgmentBands {
  let hitl = Math.max(0, Number.isFinite(prev.hitl) ? prev.hitl : 0);
  let cap = Math.max(MIN_CAP, Number.isFinite(prev.cap) ? prev.cap : MIN_CAP);
  let daily = Math.max(MIN_CAP, Number.isFinite(prev.daily) ? prev.daily : MIN_CAP);
  const gap = preserveGap(hitl, cap);
  const ratio = preserveRatio(cap, daily);
  const next = Number.isFinite(value) ? value : 0;

  if (id === "hitl") {
    hitl = Math.max(0, roundStep(next));
    // Raising review threshold into/past ceiling → push ceiling, keep gap.
    if (hitl + MIN_GAP > cap) {
      cap = roundStep(hitl + gap);
    }
    // Soft: if review band ate most of the room under cap, widen cap a bit.
    else if (cap - hitl < gap * 0.5 && hitl > 0) {
      cap = roundStep(hitl + gap);
    }
    // Daily follows with preserved headroom ratio (at least 1×).
    const wantDaily = roundStep(cap * Math.max(1, ratio), 1);
    if (wantDaily > daily) daily = wantDaily;
    if (cap > daily) daily = cap;
  } else if (id === "cap") {
    cap = Math.max(MIN_CAP, roundStep(next));
    if (hitl + MIN_GAP > cap) {
      hitl = Math.max(0, roundStep(cap - gap));
    }
    // Lift daily to preserve prior headroom ratio when ceiling rises.
    const wantDaily = roundStep(cap * Math.max(1, ratio), 1);
    if (wantDaily > daily || cap > daily) {
      daily = Math.max(cap, wantDaily);
    }
  } else {
    daily = Math.max(MIN_CAP, roundStep(next, 1));
    if (daily < cap) {
      // Pull ceiling down with the daily budget; keep review gap under new cap.
      cap = daily;
      if (hitl + MIN_GAP > cap) {
        hitl = Math.max(0, roundStep(cap - gap));
      }
    } else if (daily < cap * ratio * 0.85 && ratio > 1) {
      // User is compressing headroom intentionally — leave cap, just set daily.
    }
  }

  if (hitl + MIN_GAP > cap) hitl = Math.max(0, roundStep(cap - MIN_GAP));
  if (cap > daily) daily = cap;

  return { hitl, cap, daily };
}

export function formatBandUsd(n: number): string {
  return Number.isInteger(n) ? String(n) : String(roundStep(n));
}

/** Suggested chart ceiling that grows as the user pushes limits up. */
export function judgmentScaleMax(bands: JudgmentBands): number {
  const peak = Math.max(bands.hitl, bands.cap, bands.daily, 40);
  return Math.max(peak * 1.35, peak + 25, 80);
}
