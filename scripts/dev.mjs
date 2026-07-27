#!/usr/bin/env node
/**
 * `npm run dev` — the API and the console together.
 *
 * The API is a persistent process and is deliberately not embedded in the Next
 * app (see docs/adr/2026-07-26-persistent-api-over-serverless.md). That is
 * correct, and it made local startup a two-terminal ritual that is easy to get
 * half-right: start only the web app and every console action fails at the
 * proxy with a message about ABI_API_ORIGIN.
 *
 * One command, both processes, no new dependencies. Ctrl-C stops both, and if
 * either exits the other is torn down rather than left running as a confusing
 * half-stack.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

const SERVICES = [
  { name: "api", args: ["run", "dev:api"], color: "[36m" },
  { name: "web", args: ["run", "dev:web"], color: "[35m" },
];

const RESET = "[0m";
const children = [];
let shuttingDown = false;

function prefixed(name, color, stream, chunk) {
  for (const line of chunk.toString().split(/\r?\n/)) {
    if (!line.trim()) continue;
    stream.write(`${color}[${name}]${RESET} ${line}\n`);
  }
}

function stopAll(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode === null) child.kill("SIGTERM");
  }
  // Give them a moment to close their listeners before the parent leaves.
  setTimeout(() => process.exit(code), 300);
}

for (const svc of SERVICES) {
  const child = spawn(npm, svc.args, {
    cwd: root,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    // Windows resolves npm.cmd through the shell.
    shell: process.platform === "win32",
  });
  child.stdout.on("data", (c) => prefixed(svc.name, svc.color, process.stdout, c));
  child.stderr.on("data", (c) => prefixed(svc.name, svc.color, process.stderr, c));
  child.on("exit", (code) => {
    if (!shuttingDown) {
      process.stderr.write(`\n${svc.color}[${svc.name}]${RESET} exited (${code}) — stopping the stack.\n`);
    }
    stopAll(code ?? 0);
  });
  children.push(child);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => stopAll(0));
}

process.stdout.write(
  `\n  API     http://localhost:8787/health\n` +
    `  Console http://localhost:3000\n\n` +
    `  The console proxies /abi-api to the API automatically in local dev.\n\n`,
);
