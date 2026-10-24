import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clampAmount,
  commitAmount,
  formatAmountDisplay,
  parseAmount,
  sanitizeTyped,
  stepAmount,
} from "./amount-stepper";

describe("amount stepper", () => {
  it("parses typed amounts with currency noise", () => {
    assert.equal(parseAmount("$1,250.50"), 1250.5);
    assert.equal(parseAmount(" 12 "), 12);
    assert.equal(parseAmount("10 USDC"), 10);
    assert.equal(parseAmount(""), null);
    assert.equal(parseAmount("abc"), null);
    assert.equal(parseAmount("-5"), null, "negative amounts are not amounts");
  });

  it("steps up and down on the step grid", () => {
    assert.equal(stepAmount("10", 1, { step: 5 }), "15");
    assert.equal(stepAmount("10", -1, { step: 5 }), "5");
    assert.equal(stepAmount("12.3", 1, { step: 5 }), "15", "snaps up to the grid");
    assert.equal(stepAmount("12.3", -1, { step: 5 }), "10", "snaps down to the grid");
    assert.equal(stepAmount("0.1", 1, { step: 0.1, decimals: 2 }), "0.2", "no float drift");
    assert.equal(stepAmount("0.3", -1, { step: 0.1, decimals: 2 }), "0.2");
  });

  it("never goes below zero or the minimum, nor above the maximum", () => {
    assert.equal(stepAmount("0", -1, { step: 1 }), "0");
    assert.equal(stepAmount("1", -1, { step: 5 }), "0");
    assert.equal(stepAmount("0.5", -1, { step: 0.5, min: 0.5 }), "0.5");
    assert.equal(stepAmount("99", 1, { step: 5, max: 100 }), "100");
    assert.equal(clampAmount(-3), 0);
    assert.equal(clampAmount(150, { max: 100 }), 100);
  });

  it("steps from an empty field", () => {
    assert.equal(stepAmount("", 1, { step: 5 }), "5");
    assert.equal(stepAmount("", -1, { step: 5 }), "0");
    assert.equal(stepAmount("", 1, { step: 1, min: 3 }), "3");
  });

  it("supports a larger jump (Shift / PageUp)", () => {
    assert.equal(stepAmount("10", 1, { step: 1 }, 10), "20");
    assert.equal(stepAmount("10", -1, { step: 1 }, 10), "0");
  });

  it("only lets valid partial amounts through while typing", () => {
    assert.equal(sanitizeTyped("12."), "12.");
    assert.equal(sanitizeTyped("12.34"), "12.34");
    assert.equal(sanitizeTyped("12.345"), null, "more decimals than allowed");
    assert.equal(sanitizeTyped("12.345", 6), "12.345");
    assert.equal(sanitizeTyped("1,000"), "1000");
    assert.equal(sanitizeTyped("-1"), null);
    assert.equal(sanitizeTyped("1e5"), null);
    assert.equal(sanitizeTyped(""), "");
  });

  it("formats for display with separators and money decimals", () => {
    assert.equal(formatAmountDisplay("1250.5"), "1,250.50");
    assert.equal(formatAmountDisplay("1000"), "1,000");
    assert.equal(formatAmountDisplay(""), "");
  });

  it("commits a clamped, tidy value on blur", () => {
    assert.equal(commitAmount("12.50"), "12.5");
    assert.equal(commitAmount("150", { max: 100 }), "100");
    assert.equal(commitAmount("0.2", { min: 0.5 }), "0.5");
    assert.equal(commitAmount(""), "");
  });
});
