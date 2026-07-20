/**
 * Observability sink — dashboards / Prometheus / OTel plug in here.
 * Analytics stay pure functions; this is the optional side-channel.
 */
export interface ObservabilityEvent {
  name: string;
  orgId?: string;
  agentId?: string;
  attrs?: Record<string, unknown>;
  at?: string;
}

export interface ObservabilitySink {
  record(event: ObservabilityEvent): void;
  /** Optional Prometheus text exposition. */
  prometheusText?: () => string;
}

class NoopSink implements ObservabilitySink {
  record(): void {
    /* default: silence */
  }
}

let sink: ObservabilitySink = new NoopSink();

export function setObservabilitySink(next: ObservabilitySink): void {
  sink = next;
}

export function getObservabilitySink(): ObservabilitySink {
  return sink;
}

export function recordObs(event: ObservabilityEvent): void {
  try {
    sink.record({ ...event, at: event.at ?? new Date().toISOString() });
  } catch (e) {
    console.error("observability sink failed:", e);
  }
}

/** In-process Prometheus counter sink (no client dependency). */
export class PrometheusSink implements ObservabilitySink {
  private readonly counters = new Map<string, number>();
  private readonly consoleAlso: boolean;

  constructor(opts?: { consoleAlso?: boolean }) {
    this.consoleAlso = opts?.consoleAlso ?? false;
  }

  record(event: ObservabilityEvent): void {
    const key = sanitizeMetric(event.name);
    this.counters.set(key, (this.counters.get(key) ?? 0) + 1);
    if (this.consoleAlso && process.env.ABI_OBS_SILENT !== "1") {
      console.log(JSON.stringify({ type: "abi.obs", ...event }));
    }
  }

  prometheusText(): string {
    const lines: string[] = [
      "# HELP abi_events_total ABI observability event counters",
      "# TYPE abi_events_total counter",
    ];
    for (const [name, value] of [...this.counters.entries()].sort((a, b) =>
      a[0].localeCompare(b[0]),
    )) {
      lines.push(`abi_events_total{event="${name}"} ${value}`);
    }
    lines.push("");
    return lines.join("\n");
  }
}

function sanitizeMetric(name: string): string {
  return name.replace(/[^a-zA-Z0-9_:]/g, "_").slice(0, 120) || "unknown";
}
