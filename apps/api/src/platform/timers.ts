/**
 * Node's `Timeout.unref()` is absent on Cloudflare Workers (timers are numbers).
 * Safe no-op there so module-load side effects do not crash the Durable Object.
 */
export function unrefTimer(timer: unknown): void {
  if (
    timer &&
    typeof timer === "object" &&
    "unref" in timer &&
    typeof (timer as { unref?: () => void }).unref === "function"
  ) {
    (timer as { unref: () => void }).unref();
  }
}
