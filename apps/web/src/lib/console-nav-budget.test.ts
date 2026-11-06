/**
 * Source-level guards for the Oct 30 console fixes (nav toggle + Budget health
 * icon). The behaviour itself was checked in a browser; these keep a later
 * restyle from quietly bringing the arrow back or re-breaking the icon button.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { DRAWER_MAX_WIDTH_PX, isDrawerViewport } from "./nav-toggle";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const consolePage = readFileSync(new URL("../app/console/page.tsx", import.meta.url), "utf8");
const sellerConsole = readFileSync(new URL("./seller-console.tsx", import.meta.url), "utf8");

describe("console nav: the logo is the toggle", () => {
  for (const [name, src] of [
    ["buyer console", consolePage],
    ["seller console", sellerConsole],
  ] as const) {
    it(`${name} has no separate collapse arrow and an accessible logo toggle`, () => {
      assert.doesNotMatch(src, /rail-collapse/);
      assert.doesNotMatch(src, /name=\{railCollapsed \? "arrowRight" : "arrowLeft"\}/);
      assert.match(src, /className="rail-brand rail-brand-toggle"/);
      assert.match(src, /aria-expanded=\{!railCollapsed\}/);
      assert.match(src, /aria-label=\{railCollapsed \? "Expand navigation" : "Collapse navigation"\}/);
      assert.match(src, /aria-controls="(console|seller)-rail"/);
    });
  }

  it("drops the old arrow CSS (including the hover swap that hid the logo)", () => {
    assert.doesNotMatch(css, /\.rail-collapse/);
    assert.match(css, /\.rail-brand\.rail-brand-toggle\s*\{/);
    assert.match(css, /\.rail-brand\.rail-brand-toggle:focus-visible/);
  });

  it("treats the phone breakpoint as the drawer", () => {
    const mm = (matches: boolean) => ({ matchMedia: () => ({ matches }) as MediaQueryList });
    assert.equal(isDrawerViewport(mm(true)), true);
    assert.equal(isDrawerViewport(mm(false)), false);
    assert.equal(isDrawerViewport(undefined), false);
    assert.match(css, new RegExp(`@media \\(max-width: ${DRAWER_MAX_WIDTH_PX}px\\)`));
  });
});

describe("Budget health icon button", () => {
  it("overrides the global button padding so the glyph stays centred", () => {
    const rule = css.match(/\.ops-icon-link\s*\{([^}]*)\}/)?.[1] ?? "";
    assert.match(rule, /padding:\s*0;/);
    assert.match(rule, /flex:\s*0 0 auto;/);
  });
});
