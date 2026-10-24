"use client";

/**
 * AmountStepper — a money input with − / + buttons.
 *
 * - Still typeable (digits and one decimal point; "$" and "," are tolerated).
 * - ArrowUp / ArrowDown step once; Shift+Arrow or PageUp / PageDown step ×10;
 *   Home / End jump to min / max when a max is set.
 * - Never below `min` (0 by default), never above `max`.
 * - Shows "1,250.50" when not being edited, the raw value while editing.
 * - The value it reports is a plain decimal string ("1250.5"), ready for the API.
 * - Accessible: role="spinbutton" with aria-valuemin/max/now/text, labelled
 *   buttons, and a visible unit.
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import {
  commitAmount,
  formatAmountDisplay,
  parseAmount,
  sanitizeTyped,
  stepAmount,
  type StepperBounds,
} from "@/lib/amount-stepper";

export type AmountStepperProps = StepperBounds & {
  value: string;
  onChange: (next: string) => void;
  id?: string;
  /** Accessible name when there is no visible <label htmlFor>. */
  label?: string;
  /** Unit shown after the number. Defaults to USDC. Pass "" to hide. */
  unit?: string;
  /** Show a leading "$". Defaults to true for USDC amounts. */
  dollar?: boolean;
  placeholder?: string;
  disabled?: boolean;
  /** Compact height for tables and dense rows. */
  size?: "sm" | "md";
  className?: string;
  /** Extra props for the inner input (data-* attributes, aria-describedby…). */
  inputProps?: Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    "value" | "onChange" | "id" | "disabled" | "placeholder"
  > &
    Record<`data-${string}`, string | boolean | undefined>;
};

export function AmountStepper({
  value,
  onChange,
  id,
  label,
  unit = "USDC",
  dollar,
  placeholder,
  disabled,
  size = "md",
  className,
  inputProps,
  ...bounds
}: AmountStepperProps) {
  const [editing, setEditing] = React.useState(false);
  const decimals = bounds.decimals ?? 2;
  const showDollar = dollar ?? unit.toUpperCase() === "USDC";
  const n = parseAmount(value);
  const min = Math.max(0, bounds.min ?? 0);
  const atMin = n !== null && n <= min;
  const atMax = n !== null && bounds.max !== undefined && n >= bounds.max;

  const step = (dir: 1 | -1, multiplier = 1) => {
    if (disabled) return;
    onChange(stepAmount(value, dir, bounds, multiplier));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    inputProps?.onKeyDown?.(e);
    if (e.defaultPrevented) return;
    const big = e.shiftKey ? 10 : 1;
    if (e.key === "ArrowUp") {
      e.preventDefault();
      step(1, big);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      step(-1, big);
    } else if (e.key === "PageUp") {
      e.preventDefault();
      step(1, 10);
    } else if (e.key === "PageDown") {
      e.preventDefault();
      step(-1, 10);
    } else if (e.key === "Home" && bounds.min !== undefined) {
      e.preventDefault();
      onChange(commitAmount(String(min), bounds));
    } else if (e.key === "End" && bounds.max !== undefined) {
      e.preventDefault();
      onChange(commitAmount(String(bounds.max), bounds));
    }
  };

  return (
    <div
      className={cn(
        "amount-stepper",
        size === "sm" && "is-sm",
        disabled && "is-disabled",
        className,
      )}
      data-empty={value === "" ? "true" : undefined}
    >
      <button
        type="button"
        className="amount-stepper-btn"
        aria-label={`Decrease${label ? ` ${label}` : ""}`}
        tabIndex={-1}
        disabled={disabled || atMin}
        onClick={() => step(-1)}
      >
        <svg viewBox="0 0 24 24" aria-hidden width="14" height="14">
          <path d="M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
      <div className="amount-stepper-field">
        {showDollar && (
          <span className="amount-stepper-affix" aria-hidden>
            $
          </span>
        )}
        <input
          {...inputProps}
          id={id}
          role="spinbutton"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          aria-label={label}
          aria-valuemin={min}
          aria-valuemax={bounds.max}
          aria-valuenow={n ?? undefined}
          aria-valuetext={n === null ? "empty" : `${formatAmountDisplay(value, decimals)} ${unit}`}
          placeholder={placeholder}
          disabled={disabled}
          value={editing ? value : formatAmountDisplay(value, decimals)}
          onFocus={(e) => {
            setEditing(true);
            inputProps?.onFocus?.(e);
          }}
          onBlur={(e) => {
            setEditing(false);
            const committed = commitAmount(value, bounds);
            if (committed !== value) onChange(committed);
            inputProps?.onBlur?.(e);
          }}
          onChange={(e) => {
            const next = sanitizeTyped(e.target.value, decimals);
            if (next !== null) onChange(next);
          }}
          onKeyDown={onKeyDown}
        />
        {unit && (
          <span className="amount-stepper-unit" aria-hidden>
            {unit}
          </span>
        )}
      </div>
      <button
        type="button"
        className="amount-stepper-btn"
        aria-label={`Increase${label ? ` ${label}` : ""}`}
        tabIndex={-1}
        disabled={disabled || atMax}
        onClick={() => step(1)}
      >
        <svg viewBox="0 0 24 24" aria-hidden width="14" height="14">
          <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
