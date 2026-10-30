import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const shell = readFileSync(new URL("./marketing-shell.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("waitlist link points at the public /waitlist page", () => {
  assert.match(shell, /export const WAITLIST_HREF = "\/waitlist";/);
});

test("top nav has a Join waitlist link on desktop (beside Open console) and in the mobile menu", () => {
  const cta = shell.slice(shell.indexOf('className="marketing-nav-cta"'));
  assert.match(
    cta,
    /marketing-nav-waitlist[\s\S]*href=\{WAITLIST_HREF\}[\s\S]*Join waitlist[\s\S]*Open console/,
  );
  const links = shell.slice(
    shell.indexOf('className="marketing-links"'),
    shell.indexOf('className="marketing-nav-cta"'),
  );
  assert.match(links, /href=\{WAITLIST_HREF\}[\s\S]*marketing-links-waitlist[\s\S]*Join waitlist/);
});

test("only one waitlist link shows at a time: desktop hides the menu item, mobile hides the button", () => {
  assert.match(css, /\.marketing-links a\.marketing-links-waitlist \{\s*display: none;/);
  const mobile = css.slice(css.indexOf("@media (max-width: 900px) {\n  .marketing-burger"));
  const block = mobile.slice(0, mobile.indexOf("\n}\n"));
  assert.match(block, /\.marketing-nav-waitlist \{\s*display: none;/);
  assert.match(block, /\.marketing-links a\.marketing-links-waitlist \{\s*display: block;/);
});
