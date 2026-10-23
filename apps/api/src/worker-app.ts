/**
 * Cloudflare Workers entry surface for the ABI API.
 *
 * Imported only from apps/api-worker after Durable Object SQL is injected.
 * Does not call app.listen; background intervals are replaced by DO alarms.
 */
import { app } from "./index.js";
import { runAlarmJobs } from "./jobs/alarm-runner.js";

export { app, runAlarmJobs };
