/** Targeted credential scan. Reports locations only, never matched values.
 * Use --history to inspect all locally reachable revisions without rewriting Git.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
// Public test-only issuer keys; exact fingerprints, never an ignored directory.
const fixtures = {
  "apps/api/src/identity/x401/test-fixtures/expired-issuer.key.pem":
    "6c71af2e87646ed0b7c7b60aac9c8f59c086108b2c83a4f58bbdb879e90c22eb",
  "apps/api/src/identity/x401/test-fixtures/other-issuer.key.pem":
    "2dfd473b58b058921c16432d9c860ea5965a1d22f05c0003a654b15da5d72b26",
  "apps/api/src/identity/x401/test-fixtures/test-issuer.key.pem":
    "8575a001188805eb49edb9a1eba610298999de3937008b677d7c70b79eb18e82",
};
const isFixture = (file, content) =>
  fixtures[file] === createHash("sha256").update(content).digest("hex");
const rules = [
  ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["github-token", /(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})/],
  [
    "provider-key",
    /(?:sk_(?:live|test)_[A-Za-z0-9]{24,}|sk-proj-[A-Za-z0-9_-]{60,}|sk-ant-api\d+-[A-Za-z0-9_-]{60,})/,
  ],
  ["aws-access-key", /(?:AKIA|ASIA)[A-Z0-9]{16}/],
];
const git = (...args) => {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    throw new Error("Credential scan could not read Git metadata; no source contents are printed.");
  }
};
let findings = 0;
const files = git("ls-files", "-z").split("\0").filter(Boolean);
for (const file of files) {
  const content = readFileSync(file, "utf8");
  if (isFixture(file, content)) continue;
  for (const [name, pattern] of rules)
    if (pattern.test(content)) {
      // Known examples/test fixtures should be replaced with constructed tokens,
      // rather than teaching the scanner to ignore an entire sensitive directory.
      console.error(`${name}: tracked file ${file}`);
      findings++;
    }
  if (/(^|\/)\.env(?:\.[^/]+)?$/.test(file) && !/\.(example|sample|template)$/.test(file)) {
    console.error(`tracked environment file: ${file}`);
    findings++;
  }
}
if (process.argv.includes("--history")) {
  // Stream bounded commit patches individually. Never emit patch contents.
  const revisions = git("rev-list", "--all").trim().split("\n").filter(Boolean);
  for (const revision of revisions) {
    const patch = git("show", "--format=", "--no-ext-diff", "--unified=0", revision);
    for (const section of patch.split(/^diff --git /m).slice(1)) {
      const file = section.split("\n")[0]?.match(/ b\/(.+)$/)?.[1];
      const additions = section
        .split("\n")
        .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
        .join("\n");
      for (const [name, pattern] of rules)
        if (pattern.test(additions)) {
          if (file && file in fixtures && isFixture(file, git("show", `${revision}:${file}`)))
            continue;
          console.error(`${name}: historical commit ${revision}, file ${file ?? "unknown"}`);
          findings++;
        }
    }
  }
  console.log(`Inspected ${revisions.length} locally reachable revisions.`);
}
console.log(
  `Targeted scan: ${files.length} tracked files, ${findings} findings. This is not an exhaustive secret audit.`,
);
process.exitCode = findings ? 1 : 0;
