/**
 * Quiet-hours window math shared by the ABI agent (UTC).
 * Mirrors apps/web quietWindowStatus without React.
 */
export function quietHoursStatus(
  quiet: { startHour: number; endHour: number },
  now = new Date(),
): {
  inQuiet: boolean;
  enabled: boolean;
  countdown: string;
  label: string;
  clock: string;
} {
  const nowSec =
    now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds();
  const startSec = quiet.startHour * 3600;
  const endSec = quiet.endHour * 3600;
  const day = 24 * 3600;
  const clock = now.toISOString().slice(11, 19) + " UTC";
  if (startSec === endSec) {
    return {
      inQuiet: false,
      enabled: false,
      countdown: "—",
      label: "Quiet hours off",
      clock,
    };
  }
  const inQuiet =
    startSec < endSec
      ? nowSec >= startSec && nowSec < endSec
      : nowSec >= startSec || nowSec < endSec;
  const secsUntil = (target: number) => {
    let d = target - nowSec;
    if (d <= 0) d += day;
    return d;
  };
  const split = (totalSec: number) => {
    const s = Math.max(0, Math.floor(totalSec));
    const hours = Math.floor(s / 3600);
    const minutes = Math.floor((s % 3600) / 60);
    const seconds = s % 60;
    if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
    if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
    return `${seconds}s`;
  };
  if (inQuiet) {
    return {
      inQuiet: true,
      enabled: true,
      countdown: split(secsUntil(endSec)),
      label: "In quiet hours",
      clock,
    };
  }
  return {
    inQuiet: false,
    enabled: true,
    countdown: split(secsUntil(startSec)),
    label: "Open hours",
    clock,
  };
}
