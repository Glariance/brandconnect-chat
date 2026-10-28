import { postVisitorPresence } from "@/lib/chat-api";
import { newTabId, sanitizePagePath } from "@/lib/presence-utils";

const HEARTBEAT_MS = 25_000;

export type PresenceController = {
  stop: () => void;
  setChatOpened: (open: boolean) => void;
  setPage: (page: string) => void;
  noteActivity: () => void;
};

/**
 * Heartbeats while the document is visible. Hidden tabs pause sending so
 * server expiry (~90s) marks them offline without relying on unload.
 */
export function startVisitorPresence(opts: {
  token: string;
  initialPage: string;
  chatOpened?: boolean;
  getToken?: () => string | null;
}): PresenceController {
  const tabId = newTabId();
  let page = sanitizePagePath(opts.initialPage);
  let chatOpened = Boolean(opts.chatOpened);
  let activity = true;
  let stopped = false;
  let timer: number | null = null;
  let inFlight = false;

  const token = () => opts.getToken?.() ?? opts.token;

  const beat = async () => {
    if (stopped || inFlight) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      return;
    }
    const t = token();
    if (!t) return;
    inFlight = true;
    try {
      await postVisitorPresence(t, {
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
    }, HEARTBEAT_MS);
  };

  const onVisibility = () => {
    if (document.visibilityState === "visible") {
      activity = true;
      void beat();
    }
  };

  const onActivity = () => {
    activity = true;
  };

  void beat();
  schedule();

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("pointerdown", onActivity);
    document.addEventListener("keydown", onActivity);
  }

  return {
    stop: () => {
      stopped = true;
      if (timer != null) window.clearTimeout(timer);
      timer = null;
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
        document.removeEventListener("pointerdown", onActivity);
        document.removeEventListener("keydown", onActivity);
      }
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
    noteActivity: () => {
      activity = true;
    },
  };
}
