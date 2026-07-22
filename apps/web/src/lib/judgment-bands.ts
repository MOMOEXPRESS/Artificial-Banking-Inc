/**
 * Autonomous judgment-band nesting — keep allow < review < deny without runaway growth.
 *
 * While one column moves:
 * - Enforce hitl + minGap ≤ cap ≤ daily
 * - Preserve the prior review gap / daily headroom only when nesting would break
 * - Never compound scale: hard caps stop “millions after a few swings”
 */
export type JudgmentBands = {
  hitl: number;
  cap: number;
  daily: number;
};

const MIN_GAP = 0.5;
const MIN_CAP = 0.5;
/** Preferred daily headroom multiple when we must lift daily with the ceiling. */
const HEADROOM = 2;
/** Don’t invent absurd review gaps when pushing the ceiling. */
const MAX_GAP = 50;
/** Absolute USDC ceiling for any band — stops feedback explosions. */
export const MAX_BAND = 100_000;
/** Chart scale soft ceiling — bars stay usable without runaway. */
const MAX_SCALE = 25_000;

function roundStep(n: number, step = 0.5): number {
  return Math.round(n / step) * step;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function preserveGap(hitl: number, cap: number): number {
  const raw = cap - hitl;
  if (!Number.isFinite(raw) || raw <= 0) return MIN_GAP;
  return clamp(roundStep(raw), MIN_GAP, MAX_GAP);
}

function preserveRatio(cap: number, daily: number): number {
  if (!Number.isFinite(cap) || cap <= 0) return HEADROOM;
  if (!Number.isFinite(daily) || daily < cap) return HEADROOM;
  return clamp(daily / cap, 1, HEADROOM);
}

/**
 * Apply a single-column drag. Returns a fully nested { hitl, cap, daily }.
 * Only expands neighbors when nesting would otherwise break.
 */
export function applyJudgmentBandDrag(
  id: "hitl" | "cap" | "daily",
  value: number,
  prev: JudgmentBands,
): JudgmentBands {
  let hitl = clamp(Number.isFinite(prev.hitl) ? prev.hitl : 0, 0, MAX_BAND);
  let cap = clamp(Number.isFinite(prev.cap) ? prev.cap : MIN_CAP, MIN_CAP, MAX_BAND);
  let daily = clamp(Number.isFinite(prev.daily) ? prev.daily : MIN_CAP, MIN_CAP, MAX_BAND);
  const gap = preserveGap(hitl, cap);
  const ratio = preserveRatio(cap, daily);
  const next = clamp(Number.isFinite(value) ? value : 0, 0, MAX_BAND);

  if (id === "hitl") {
    hitl = roundStep(next);
    // Only push ceiling when ask-me-above would cross/overlap it.
    if (hitl + MIN_GAP > cap) {
      cap = clamp(roundStep(hitl + gap), MIN_CAP, MAX_BAND);
    }
    if (cap > daily) {
      daily = clamp(roundStep(cap * ratio, 1), cap, MAX_BAND);
    }
  } else if (id === "cap") {
    cap = clamp(roundStep(next), MIN_CAP, MAX_BAND);
    if (hitl + MIN_GAP > cap) {
      hitl = Math.max(0, roundStep(cap - gap));
    }
    // Lift daily only when ceiling outruns it — preserve prior headroom, capped.
    if (cap > daily) {
      daily = clamp(roundStep(cap * ratio, 1), cap, MAX_BAND);
    }
  } else {
    daily = clamp(roundStep(next, 1), MIN_CAP, MAX_BAND);
    if (daily < cap) {
      cap = daily;
      if (hitl + MIN_GAP > cap) {
        hitl = Math.max(0, roundStep(cap - MIN_GAP));
      }
    }
  }

  if (hitl + MIN_GAP > cap) hitl = Math.max(0, roundStep(cap - MIN_GAP));
  if (cap > daily) daily = cap;

  return {
    hitl: clamp(hitl, 0, MAX_BAND),
    cap: clamp(cap, MIN_CAP, MAX_BAND),
    daily: clamp(daily, MIN_CAP, MAX_BAND),
  };
}

export function formatBandUsd(n: number): string {
  return Number.isInteger(n) ? String(n) : String(roundStep(n));
}

/**
 * Suggested chart ceiling. Grows gently with the bands, never explodes.
 * Column drag maxes should prefer a session-frozen scale (see SmoothBarChart).
 */
export function judgmentScaleMax(bands: JudgmentBands): number {
  const peak = Math.max(bands.hitl, bands.cap, bands.daily, 40);
  const soft = Math.max(peak * 1.25, peak + 20, 80);
  return Math.min(soft, MAX_SCALE);
}
