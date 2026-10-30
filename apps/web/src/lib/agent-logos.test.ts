import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { AGENT_LOGOS } from "./agent-logos";

const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./agent-logo-marquee.module.css", import.meta.url), "utf8");

describe("Landing page agent logo strip", () => {
  it("lists named providers with a single 24x24 path each and unique slugs", () => {
    assert.ok(AGENT_LOGOS.length >= 6);
    const slugs = new Set(AGENT_LOGOS.map((l) => l.slug));
    assert.equal(slugs.size, AGENT_LOGOS.length);
    for (const logo of AGENT_LOGOS) {
      assert.ok(logo.name.trim().length > 0, `${logo.slug} has a name`);
      assert.match(logo.path, /^M[\d.\-\s]/, `${logo.slug} path is SVG path data`);
    }
  });

  it("does not ship marks without an open licence", () => {
    const slugs = AGENT_LOGOS.map((l) => l.slug);
    for (const missing of ["openai", "xai", "cohere", "microsoft"]) {
      assert.ok(!slugs.includes(missing), `${missing} is not in the set`);
    }
  });

  it("replaces the ChatGPT connect band on the home page", () => {
    assert.match(page, /<AgentLogoMarquee \/>/);
    assert.doesNotMatch(page, /ChatGPTIntegrationBand/);
  });

  it("pauses on hover and falls back to a static wrap for reduced motion", () => {
    assert.match(css, /:hover \.track/);
    assert.match(css, /prefers-reduced-motion: reduce[\s\S]*animation: none/);
    assert.match(css, /\.duplicate\s*\{\s*display: none;/);
  });
});
