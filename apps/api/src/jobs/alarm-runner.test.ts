import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "abi-alarm-"));
process.env.POLICYVAULT_DB = join(dir, "alarm.db");
process.env.ABI_KEY_PEPPER = "test-pepper";
process.env.ABI_KEK = "test-kek";
process.env.ABI_NO_LISTEN = "1";
process.env.ABI_RUNTIME = "cloudflare-workers";

const { runAlarmJobs } = await import("./alarm-runner.js");

describe("runAlarmJobs", () => {
  it("runs due jobs and skips others within interval", async () => {
    let runs = 0;
    const jobs = [
      {
        name: "once",
        intervalMs: 60_000,
        leaseMs: 60_000,
        run: () => {
          runs += 1;
        },
      },
    ];
    const first = await runAlarmJobs(jobs);
    assert.deepEqual(first.ran, ["once"]);
    const second = await runAlarmJobs(jobs);
    assert.deepEqual(second.skipped, ["once"]);
    assert.equal(runs, 1);
  });
});
