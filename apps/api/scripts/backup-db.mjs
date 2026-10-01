#!/usr/bin/env node
/** Create a consistent SQLite snapshot using SQLite's online backup API. */
import { chmod, mkdir } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const sourcePath = resolve(process.env.POLICYVAULT_DB ?? "apps/api/data/policyvault.db");
const outputDir = resolve(process.env.ABI_BACKUP_DIR ?? "backups");
const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const outputPath = join(outputDir, `abi-${stamp}.db`);

if (!isAbsolute(sourcePath) || sourcePath === outputPath) {
  throw new Error("Invalid database backup paths.");
}
await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });
const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
try {
  await source.backup(outputPath);
} finally {
  source.close();
}
await chmod(outputPath, 0o600);
const verify = new Database(outputPath, { readonly: true, fileMustExist: true });
try {
  const result = verify.pragma("quick_check", { simple: true });
  if (result !== "ok") throw new Error(`Backup integrity check failed: ${result}`);
} finally {
  verify.close();
}
console.log(`Verified SQLite backup: ${outputPath}`);
