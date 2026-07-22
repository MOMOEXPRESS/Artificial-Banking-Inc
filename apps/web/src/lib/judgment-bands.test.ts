import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyJudgmentBandDrag, judgmentScaleMax } from "./judgment-bands.js";

describe("applyJudgmentBandDrag", () => {
  it("raises per-payment and daily headroom when ask-me-above crosses the ceiling", () => {
    const next = applyJudgmentBandDrag("hitl", 44, { hitl: 10, cap: 25, daily: 50 });
    assert.equal(next.hitl, 44);
    assert.ok(next.cap >= next.hitl + 0.5);
    assert.ok(next.daily >= next.cap);
    // Prior gap was 15 → cap becomes 59; prior ratio daily/cap=2 → daily ≥ 118
    assert.equal(next.cap, 59);
    assert.ok(next.daily >= 118);
  });

  it("pulls ask-me-above down when per-payment drops", () => {
    const next = applyJudgmentBandDrag("cap", 20, { hitl: 40, cap: 50, daily: 100 });
    assert.equal(next.cap, 20);
    assert.ok(next.hitl < next.cap);
    assert.equal(next.hitl, 10); // preserved gap 10
  });

  it("lifts daily with preserved ratio when per-payment rises", () => {
    const next = applyJudgmentBandDrag("cap", 80, { hitl: 20, cap: 40, daily: 100 });
    assert.equal(next.cap, 80);
    assert.equal(next.hitl, 20);
    // prior ratio 100/40 = 2.5 → daily 200
    assert.equal(next.daily, 200);
  });

  it("pulls ceiling down when daily is dragged below per-payment", () => {
    const next = applyJudgmentBandDrag("daily", 30, { hitl: 20, cap: 50, daily: 100 });
    assert.equal(next.daily, 30);
    assert.equal(next.cap, 30);
    assert.ok(next.hitl < next.cap);
  });

  it("grows scale max as bands rise", () => {
    const s = judgmentScaleMax({ hitl: 40, cap: 60, daily: 150 });
    assert.ok(s > 150);
  });
});
