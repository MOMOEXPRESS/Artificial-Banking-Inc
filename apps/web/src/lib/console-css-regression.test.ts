import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

describe("Console layout CSS", () => {
  it("retains the Overview information hierarchy and spending calendar", () => {
    assert.match(css, /Console-wide hierarchy pass/);
    assert.match(css, /\.ops-spending\s*\{/);
    assert.match(css, /\.ops-spending-body\s*\{/);
    assert.match(css, /\.ops-calendar-grid/);
    assert.match(css, /\.ops-spend-table\s*\{/);
  });

  it("retains the Organization Settings navigation and section summaries", () => {
    assert.match(css, /\.settings-page\s*\{/);
    assert.match(css, /\.settings-page \.set-nav\s*\{/);
    assert.match(css, /\.settings-section-summary\s*\{/);
    assert.match(css, /\.settings-section-icon\s*\{/);
  });

  it("keeps the Agent Lab styles isolated after the shared console rules", () => {
    const consoleRules = css.indexOf("Console-wide hierarchy pass");
    const labRules = css.indexOf("Playground / Agent Lab");
    assert.ok(consoleRules >= 0);
    assert.ok(labRules > consoleRules);
    assert.match(css, /\.playground-page\s*\{/);
    assert.match(css, /\.scenario-grid\s*\{/);
    assert.match(css, /\.lab-workspace\s*\{/);
  });
});
