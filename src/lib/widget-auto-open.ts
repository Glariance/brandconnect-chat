/** Track agent message IDs so history/duplicates do not re-open the widget. */

export type AutoOpenDecision = {
  /** Message IDs that should trigger a one-time panel open. */
  openForIds: number[];
  /** Updated set of known message IDs. */
  knownIds: Set<number>;
};

/**
 * Mark messages as known. Returns IDs that are new agent/bot messages
 * and should expand a minimized panel once.
 */
export function noteIncomingMessages(
  knownIds: Set<number>,
  messages: Array<{ id: number; sender_type: string }>,
  opts: { seedOnly?: boolean } = {},
): AutoOpenDecision {
  const openForIds: number[] = [];
  const next = new Set(knownIds);

  for (const m of messages) {
    if (!Number.isFinite(m.id) || m.id <= 0) continue;
    if (next.has(m.id)) continue;
    next.add(m.id);
    if (opts.seedOnly) continue;
    if (m.sender_type === "agent" || m.sender_type === "bot") {
      openForIds.push(m.id);
    }
  }

  return { openForIds, knownIds: next };
}

/** True when the scroll container is near the bottom (visitor following live). */
export function isNearBottom(el: HTMLElement, thresholdPx = 80): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= thresholdPx;
}
