import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyJudgmentBandDrag, judgmentScaleMax, MAX_BAND } from "./judgment-bands.js";

describe("applyJudgmentBandDrag", () => {
  it("raises per-payment when ask-me-above crosses the ceiling, without exploding daily", () => {
    const next = applyJudgmentBandDrag("hitl", 44, { hitl: 10, cap: 25, daily: 50 });
    assert.equal(next.hitl, 44);
    assert.ok(next.cap >= next.hitl + 0.5);
    assert.ok(next.daily >= next.cap);
    // Prior gap was 15 (capped by MAX_GAP) → cap 59; ratio 2 → daily 118
    assert.equal(next.cap, 59);
    assert.equal(next.daily, 118);
  });

  it("pulls ask-me-above down when per-payment drops", () => {
    const next = applyJudgmentBandDrag("cap", 20, { hitl: 40, cap: 50, daily: 100 });
    assert.equal(next.cap, 20);
    assert.ok(next.hitl < next.cap);
    assert.equal(next.hitl, 10); // preserved gap 10
  });

  it("lifts daily only when ceiling outruns it", () => {
    const kept = applyJudgmentBandDrag("cap", 80, { hitl: 20, cap: 40, daily: 100 });
    assert.equal(kept.cap, 80);
    assert.equal(kept.hitl, 20);
    // daily already above new cap — leave headroom alone
    assert.equal(kept.daily, 100);

    const lifted = applyJudgmentBandDrag("cap", 120, { hitl: 20, cap: 40, daily: 100 });
    assert.equal(lifted.cap, 120);
    // prior ratio 100/40 = 2.5 → clamped to HEADROOM 2 → daily 240
    assert.equal(lifted.daily, 240);
  });

  it("does not lift daily when raising ask-me-above still fits under ceiling", () => {
    const next = applyJudgmentBandDrag("hitl", 15, { hitl: 10, cap: 25, daily: 50 });
    assert.equal(next.hitl, 15);
    assert.equal(next.cap, 25);
    assert.equal(next.daily, 50);
  });

  it("pulls ceiling down when daily is dragged below per-payment", () => {
    const next = applyJudgmentBandDrag("daily", 30, { hitl: 20, cap: 50, daily: 100 });
    assert.equal(next.daily, 30);
    assert.equal(next.cap, 30);
    assert.ok(next.hitl < next.cap);
  });

  it("does not explode across repeated swings", () => {
    let bands = { hitl: 10, cap: 25, daily: 50 };
    for (let i = 0; i < 40; i++) {
      bands = applyJudgmentBandDrag("hitl", 80 + (i % 5), bands);
      bands = applyJudgmentBandDrag("cap", 90 + (i % 7), bands);
      bands = applyJudgmentBandDrag("daily", 120 + (i % 11), bands);
      bands = applyJudgmentBandDrag("hitl", 20, bands);
    }
    assert.ok(bands.hitl <= MAX_BAND);
    assert.ok(bands.cap <= MAX_BAND);
    assert.ok(bands.daily <= MAX_BAND);
    assert.ok(bands.daily < 10_000, `daily blew up to ${bands.daily}`);
  });

  it("clamps absurd inputs", () => {
    const next = applyJudgmentBandDrag("daily", 1e12, { hitl: 10, cap: 25, daily: 50 });
    assert.equal(next.daily, MAX_BAND);
  });

  it("grows scale max gently and caps it", () => {
    const s = judgmentScaleMax({ hitl: 40, cap: 60, daily: 150 });
    assert.ok(s > 150);
    assert.ok(s < 500);
    const huge = judgmentScaleMax({ hitl: 50_000, cap: 80_000, daily: 100_000 });
    assert.ok(huge <= 25_000);
  });
});
