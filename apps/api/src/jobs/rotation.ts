/**
 * Persisted round-robin position for jobs that cannot visit every org in one
 * tick. Stored in job_state so it survives Durable Object eviction.
 */
import { store } from "../store.js";

export function rotationStart(name: string, length: number): number {
  if (length <= 0) return 0;
  const raw = Number(store.getJobState(`rr:${name}`) ?? 0);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) % length : 0;
}

export function saveRotation(name: string, start: number, visited: number, length: number): void {
  if (length <= 0 || visited <= 0) return;
  store.setJobState(`rr:${name}`, String((start + visited) % length));
}

export function rotate<T>(items: T[], start: number): T[] {
  return [...items.slice(start), ...items.slice(0, start)];
}
