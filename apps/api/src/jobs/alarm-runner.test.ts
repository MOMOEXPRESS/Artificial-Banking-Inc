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

describe("alarm state survives Durable Object eviction", () => {
  it("a slow job's last run is persisted, so a fresh instance does not re-run it", async () => {
    const { store } = await import("../store.js");
    let runs = 0;
    const job = {
      name: "hourly-persisted",
      intervalMs: 60 * 60_000,
      leaseMs: 60_000,
      run: () => {
        runs += 1;
      },
    };
    await runAlarmJobs([job]);
    assert.equal(runs, 1);
    assert.ok(Number(store.getJobState("last-run:hourly-persisted")) > 0);
  });

  it("round-robin positions are persisted", async () => {
    const { rotationStart, saveRotation, rotate } = await import("./rotation.js");
    saveRotation("t", 1, 2, 5);
    assert.equal(rotationStart("t", 5), 3);
    assert.deepEqual(rotate([0, 1, 2, 3, 4], 3), [3, 4, 0, 1, 2]);
    // A shrunken list still yields a valid start.
    assert.equal(rotationStart("t", 2), 1);
  });
});
