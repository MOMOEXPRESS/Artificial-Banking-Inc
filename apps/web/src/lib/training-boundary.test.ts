/**
 * The training layer (lib/playground/training) must stay removable: only the
 * playground view may import it. ESLint enforces this too
 * (no-restricted-imports); this test keeps the guarantee even if lint is
 * skipped.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";

const SRC = join(__dirname, "..");
const ALLOWED = new Set(["lib/playground-view.tsx"]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

describe("training boundary", () => {
  it("only the playground view imports the training layer", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = relative(SRC, file).replace(/\\/g, "/");
      if (rel.startsWith("lib/playground/training/") || ALLOWED.has(rel)) continue;
      const text = readFileSync(file, "utf8");
      if (/from\s+["'][^"']*playground\/training[^"']*["']/.test(text)) offenders.push(rel);
    }
    assert.deepEqual(offenders, []);
  });

  it("the workflow and flows never reach into training", () => {
    for (const dir of ["lib/workflow", "lib/flows"]) {
      for (const file of walk(join(SRC, dir))) {
        assert.ok(
          !/playground/.test(
            readFileSync(file, "utf8")
              .match(/from\s+["'][^"']+["']/g)
              ?.join(" ") ?? "",
          ),
          file,
        );
      }
    }
  });
});
