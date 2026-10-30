import type { LiveVisitor } from "@/lib/presence-utils";

/**
 * Tracks which visitors are already known so heartbeat / reconnect / filter
 * changes do not spam arrival alerts. A later visit after offline expiry
 * (visitor left knownOnline, then returns) rings once again.
 */
export function createVisitorArrivalTracker() {
  let seeded = false;
  const knownOnline = new Set<number>();
  /** Dedup toast+sound for the same appearance window. */
  const announcedKeys = new Set<string>();

  const appearanceKey = (v: LiveVisitor) =>
    `${v.visitor_id}:${v.first_seen_at ?? v.version}`;

  const isOnline = (v: LiveVisitor) => v.status === "active" || v.status === "idle";

  const seedBaseline = (rows: LiveVisitor[]) => {
    knownOnline.clear();
    for (const v of rows) {
      if (isOnline(v)) knownOnline.add(v.visitor_id);
    }
    seeded = true;
  };

  /** Filter change / reconnect hydrate: establish baseline without alerts. */
  const resetBaseline = (rows: LiveVisitor[]) => {
    announcedKeys.clear();
    seedBaseline(rows);
  };

  const noteOffline = (visitorId: number) => {
    knownOnline.delete(visitorId);
  };

  const markAnnounced = (visitor: LiveVisitor): boolean => {
    const key = appearanceKey(visitor);
    if (announcedKeys.has(key)) return false;
    announcedKeys.add(key);
    if (announcedKeys.size > 500) {
      const first = announcedKeys.values().next().value;
      if (first !== undefined) announcedKeys.delete(first);
    }
    return true;
  };

  /**
   * Echo / single presence update. Returns visitor if this is a new arrival to announce.
   */
  const noteUpdate = (visitor: LiveVisitor, reason: string): LiveVisitor | null => {
    if (!seeded) return null;
    if (reason === "offline" || visitor.status === "offline") {
      noteOffline(visitor.visitor_id);
      return null;
    }
    if (!isOnline(visitor)) return null;

    const wasKnown = knownOnline.has(visitor.visitor_id);
    knownOnline.add(visitor.visitor_id);

    // Heartbeats / page bumps while already online must not alert.
    if (wasKnown && reason !== "appeared") return null;
    // Fresh appearance (or return after we dropped them from knownOnline).
    if (!markAnnounced(visitor)) return null;
    return visitor;
  };

  /**
   * HTTP list reconcile after baseline. Returns newly appeared visitors (once each).
   */
  const noteRows = (rows: LiveVisitor[]): LiveVisitor[] => {
    if (!seeded) {
      seedBaseline(rows);
      return [];
    }
    const nextIds = new Set<number>();
    const arrivals: LiveVisitor[] = [];
    for (const v of rows) {
      if (!isOnline(v)) continue;
      nextIds.add(v.visitor_id);
      if (!knownOnline.has(v.visitor_id) && markAnnounced(v)) {
        arrivals.push(v);
      }
    }
    // Anyone missing from the HTTP list is offline for tracking purposes.
    for (const id of [...knownOnline]) {
      if (!nextIds.has(id)) knownOnline.delete(id);
    }
    for (const id of nextIds) knownOnline.add(id);
    return arrivals;
  };

  return {
    get seeded() {
      return seeded;
    },
    seedBaseline,
    resetBaseline,
    noteUpdate,
    noteRows,
    noteOffline,
    /** Test helper */
    _knownOnline: () => new Set(knownOnline),
    _announcedKeys: () => new Set(announcedKeys),
  };
}

export type VisitorArrivalTracker = ReturnType<typeof createVisitorArrivalTracker>;
