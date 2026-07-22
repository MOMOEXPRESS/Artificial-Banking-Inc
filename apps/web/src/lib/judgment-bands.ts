/**
 * Autonomous judgment-band nesting.
 * Keep allow < review < deny while dragging one column — preserve the review gap
 * (cap − hitl) and push daily when the per-payment ceiling rises.
 */

export type JudgmentBands = {
  hitl: number;
  cap: number;
  daily: number;
};

const MIN_GAP = 0.5;
const MIN_CAP = 0.5;

function roundStep(n: number, step = 0.5): number {
  return Math.round(n / step) * step;
}

function preserveGap(hitl: number, cap: number): number {
  const raw = cap - hitl;
  if (!Number.isFinite(raw) || raw <= 0) return MIN_GAP;
  return Math.max(MIN_GAP, roundStep(raw));
}

/**
 * Apply a single-column drag. Returns a fully nested { hitl, cap, daily }.
 * - Raising Ask-me-above past Per-payment pushes the ceiling (and daily if needed).
 * - Lowering Per-payment pulls Ask-me-above down to keep the prior gap.
 * - Raising Per-payment above Daily max lifts Daily max.
 * - Lowering Daily max below Per-payment pulls the ceiling (and hitl) down.
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
  const next = Number.isFinite(value) ? value : 0;

  if (id === "hitl") {
    hitl = Math.max(0, roundStep(next));
    if (hitl + MIN_GAP > cap) {
      cap = roundStep(hitl + gap);
    }
    if (cap > daily) daily = cap;
  } else if (id === "cap") {
    cap = Math.max(MIN_CAP, roundStep(next));
    if (hitl + MIN_GAP > cap) {
      hitl = Math.max(0, roundStep(cap - gap));
    }
    if (cap > daily) daily = cap;
  } else {
    daily = Math.max(MIN_CAP, roundStep(next, 1));
    if (daily < cap) {
      cap = daily;
      if (hitl + MIN_GAP > cap) {
        hitl = Math.max(0, roundStep(cap - gap));
      }
    }
  }

  // Final nest invariant
  if (hitl + MIN_GAP > cap) hitl = Math.max(0, roundStep(cap - MIN_GAP));
  if (cap > daily) daily = cap;

  return { hitl, cap, daily };
}

export function formatBandUsd(n: number): string {
  return Number.isInteger(n) ? String(n) : String(roundStep(n));
}
