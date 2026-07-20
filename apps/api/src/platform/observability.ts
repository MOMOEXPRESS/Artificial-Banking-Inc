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
