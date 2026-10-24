/**
 * Pure helpers behind <AmountStepper>. Amounts travel as plain decimal
 * strings ("1250.5") because that is what the API takes; formatting with
 * separators is display-only and never round-trips into a value.
 */

export type StepperBounds = {
  /** Smallest allowed value. Amounts are never negative, so default 0. */
  min?: number;
  /** Largest allowed value, if any. */
  max?: number;
  /** Increment for +/- and arrow keys. */
  step?: number;
  /** Decimal places kept (USDC supports 6; money UIs usually show 2). */
  decimals?: number;
};

const DEFAULTS: { min: number; step: number; decimals: number } = { min: 0, step: 1, decimals: 2 };

function bounds(b: StepperBounds) {
  const min = Math.max(0, b.min ?? DEFAULTS.min);
  const max = b.max !== undefined && Number.isFinite(b.max) ? Math.max(min, b.max) : undefined;
  const step = b.step && b.step > 0 ? b.step : DEFAULTS.step;
  const decimals = Math.min(6, Math.max(0, b.decimals ?? DEFAULTS.decimals));
  return { min, max, step, decimals };
}

/** Parse a typed amount; tolerates "$", spaces and thousands separators. */
export function parseAmount(text: string): number | null {
  const cleaned = String(text ?? "")
    .replace(/[$,\s]/g, "")
    .replace(/usdc$/i, "");
  if (!cleaned) return null;
  if (!/^\d*\.?\d*$/.test(cleaned) || cleaned === ".") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Round to the kept decimals and drop trailing zeros: 12.50 -> "12.5". */
export function toAmountString(n: number, decimals = DEFAULTS.decimals): string {
  const fixed = n.toFixed(decimals);
  return fixed.includes(".") ? fixed.replace(/\.?0+$/, "") : fixed;
}

export function clampAmount(n: number, b: StepperBounds = {}): number {
  const { min, max } = bounds(b);
  let v = Math.max(min, n);
  if (max !== undefined) v = Math.min(max, v);
  return v;
}

/**
 * One step up or down from the current text. Snaps to the step grid first, so
 * 12.3 with step 5 goes to 15 (up) or 10 (down), the way a native spinner does.
 * An empty field steps from the minimum.
 */
export function stepAmount(
  current: string,
  direction: 1 | -1,
  b: StepperBounds = {},
  multiplier = 1,
): string {
  const { min, step, decimals } = bounds(b);
  const size = step * Math.max(1, multiplier);
  const parsed = parseAmount(current);
  if (parsed === null) {
    return toAmountString(
      clampAmount(direction > 0 ? min + (min === 0 ? size : 0) : min, b),
      decimals,
    );
  }
  // Work in integer units of the smallest decimal to dodge float drift.
  const scale = 10 ** decimals;
  const units = Math.round(parsed * scale);
  const stepUnits = Math.max(1, Math.round(size * scale));
  const onGrid = units % stepUnits === 0;
  let next: number;
  if (direction > 0) {
    next = onGrid ? units + stepUnits : Math.ceil(units / stepUnits) * stepUnits;
  } else {
    next = onGrid ? units - stepUnits : Math.floor(units / stepUnits) * stepUnits;
  }
  return toAmountString(clampAmount(next / scale, b), decimals);
}

/**
 * Keep only what can become a valid amount while the user is still typing:
 * digits and one decimal point, at most `decimals` places. Returns null when
 * the keystroke should be rejected outright.
 */
export function sanitizeTyped(text: string, decimals = DEFAULTS.decimals): string | null {
  const cleaned = String(text ?? "").replace(/[$,\s]/g, "");
  if (cleaned === "") return "";
  if (!/^\d*\.?\d*$/.test(cleaned)) return null;
  const [, frac = ""] = cleaned.split(".");
  if (frac.length > decimals) return null;
  return cleaned;
}

/** "1250.5" -> "1,250.50" for display when the field is not being edited. */
export function formatAmountDisplay(text: string, decimals = DEFAULTS.decimals): string {
  const n = parseAmount(text);
  if (n === null) return text;
  const shown = Math.min(2, decimals);
  return n.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(n) ? 0 : shown,
    maximumFractionDigits: decimals,
  });
}

/** Normalise on blur: clamp into bounds and tidy the string. Empty stays empty. */
export function commitAmount(text: string, b: StepperBounds = {}): string {
  const { decimals } = bounds(b);
  const n = parseAmount(text);
  if (n === null) return "";
  return toAmountString(clampAmount(n, b), decimals);
}
