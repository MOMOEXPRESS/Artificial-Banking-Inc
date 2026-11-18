import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const shell = readFileSync(new URL("./marketing-shell.tsx", import.meta.url), "utf8");

test("public navigation retains the requested order and existing destinations", () => {
  const links = shell.slice(shell.indexOf("const MARKETING_LINKS"), shell.indexOf("] as const;"));
  const labels = [...links.matchAll(/label: "([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(labels, [
    "Home",
    "Marketplace",
    "Login",
    "About",
    "Docs",
    "GitHub",
    "Partnership",
    "Join waitlist",
  ]);
  assert.match(links, /label: "Login", href: "\/console"/);
  assert.match(links, /label: "Join waitlist", href: WAITLIST_HREF/);
  assert.match(shell, /export const WAITLIST_HREF = "\/waitlist";/);
  assert.doesNotMatch(links, /\/pricing/);
});
