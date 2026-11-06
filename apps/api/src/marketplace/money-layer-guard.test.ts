/**
 * Area 7 guard: frozen money-layer files must not change without a titled
 * money-layer PR + owner approval; marketplace code must not import rails,
 * chain, ledger, or custody.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..", "..");
const manifestPath = join(repoRoot, "docs/marketplace/frozen-manifest.json");

type Manifest = {
  files: Record<string, string>;
  missingAtBaseline?: string[];
};

function walkTsFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walkTsFiles(p, out);
    else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

describe("money-layer frozen manifest", () => {
  it("matches SHA-256 of every listed frozen file", () => {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
    assert.ok(manifest.files && Object.keys(manifest.files).length > 0, "manifest empty");
    const mismatches: string[] = [];
    for (const [rel, expected] of Object.entries(manifest.files)) {
      const abs = join(repoRoot, rel);
      let actual: string;
      try {
        actual = createHash("sha256").update(readFileSync(abs)).digest("hex");
      } catch (e) {
        mismatches.push(`${rel}: missing (${String(e)})`);
        continue;
      }
      if (actual !== expected) {
        mismatches.push(
          `Money layer file changed: ${rel}. This requires explicit owner approval; update the manifest only in a PR that says so in its title.`,
        );
      }
    }
    assert.deepEqual(mismatches, []);
  });
});

describe("marketplace import boundary", () => {
  it("does not import ledger, custody, rails, or chain from marketplace sources", () => {
    const marketRoot = join(here);
    const files = walkTsFiles(marketRoot);
    const banned = [
      /from\s+["']@policyvault\/ledger["']/,
      /from\s+["']@policyvault\/custody["']/,
      /from\s+["'][^"']*\/rails(\/[^"']*)?["']/,
      /from\s+["'][^"']*\/chain(\/[^"']*)?["']/,
      /\.applyEntries\s*\(/,
    ];
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const re of banned) {
        if (re.test(src)) offenders.push(`${relative(repoRoot, file)} matches ${re}`);
      }
    }
    assert.deepEqual(offenders, []);
  });
});
