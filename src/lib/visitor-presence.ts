import { postVisitorPresence } from "@/lib/chat-api";
import { newTabId, sanitizePagePath } from "@/lib/presence-utils";

const HEARTBEAT_MS = 25_000;

export type PresenceController = {
  stop: () => void;
  setChatOpened: (open: boolean) => void;
  setPage: (page: string) => void;
  /** Host brand-page visibility (not the chat iframe / popup). */
  setHostVisible: (visible: boolean) => void;
  noteActivity: () => void;
  /** Test/debug: whether the next beat is allowed. */
  get hostVisible(): boolean;
};

/**
 * Heartbeats while the **host** page is visible.
 * Do not use the iframe's document.visibilityState — a closed popup uses a
 * visually hidden iframe, which browsers report as hidden even when the brand
 * page is in the foreground.
 */
export function startVisitorPresence(opts: {
  token: string;
  initialPage: string;
  chatOpened?: boolean;
  /** Defaults to true so the first upsert is not deferred waiting for postMessage. */
  hostVisible?: boolean;
  getToken?: () => string | null;
  heartbeatMs?: number;
  /** Injected for tests. */
  postPresence?: typeof postVisitorPresence;
}): PresenceController {
  const tabId = newTabId();
  const post = opts.postPresence ?? postVisitorPresence;
  const interval = opts.heartbeatMs ?? HEARTBEAT_MS;
  let page = sanitizePagePath(opts.initialPage);
  let chatOpened = Boolean(opts.chatOpened);
  let hostVisible = opts.hostVisible ?? true;
  let activity = true;
  let stopped = false;
  let timer: number | null = null;
  let inFlight = false;

  const token = () => opts.getToken?.() ?? opts.token;

  const beat = async () => {
    if (stopped || inFlight) return;
    if (!hostVisible) return;
    const t = token();
    if (!t) return;
    inFlight = true;
    try {
      await post(t, {
        tab_id: tabId,
        page,
        chat_opened: chatOpened,
        activity,
      });
      activity = false;
    } catch {
      /* next tick retries; auth expiry handled by widget shell */
    } finally {
      inFlight = false;
    }
  };

  const schedule = () => {
    if (stopped) return;
    if (timer != null) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      void beat().finally(schedule);
    }, interval);
  };

  // Immediate first upsert — do not wait for the interval.
  void beat();
  schedule();

  return {
    get hostVisible() {
      return hostVisible;
    },
    stop: () => {
      stopped = true;
      if (timer != null) window.clearTimeout(timer);
      timer = null;
    },
    setChatOpened: (open) => {
      chatOpened = open;
      activity = true;
      void beat();
    },
    setPage: (next) => {
      page = sanitizePagePath(next);
      activity = true;
      void beat();
    },
    setHostVisible: (visible) => {
      const was = hostVisible;
      hostVisible = visible;
      if (visible && !was) {
        activity = true;
        void beat();
      }
    },
    noteActivity: () => {
      activity = true;
    },
  };
}
