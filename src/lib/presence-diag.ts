/**
 * Development-only presence bootstrap timings (no tokens / secrets).
 * Enabled when /widget?diag=1 or import.meta.env.DEV.
 */

export type PresenceDiagStage =
  | "widget_mount"
  | "listener_ready"
  | "handshake_sent"
  | "handshake_ack"
  | "config"
  | "session"
  | "presence_start"
  | "presence_ok"
  | "presence_err"
  | "host_visibility"
  | "page"
  | "chat_state";

export type PresenceDiagEvent = {
  t: number;
  stage: PresenceDiagStage;
  detail?: string;
};

const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();

let events: PresenceDiagEvent[] = [];
const listeners = new Set<() => void>();

export function presenceDiagEnabled(searchDiag?: string | boolean | null): boolean {
  if (searchDiag === true || searchDiag === "1" || searchDiag === "true") return true;
  try {
    return Boolean(import.meta.env.DEV);
  } catch {
    return false;
  }
}

export function presenceDiagReset(): void {
  events = [];
  notify();
}

export function presenceDiagMark(stage: PresenceDiagStage, detail?: string): void {
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  events = [...events, { t: Math.round(now - startedAt), stage, ...(detail ? { detail } : {}) }].slice(-80);
  notify();
  if (typeof window !== "undefined") {
    (window as unknown as { __bcPresenceDiag?: PresenceDiagEvent[] }).__bcPresenceDiag = events;
  }
}

export function presenceDiagSnapshot(): PresenceDiagEvent[] {
  return events;
}

export function subscribePresenceDiag(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function notify(): void {
  for (const cb of listeners) cb();
}
