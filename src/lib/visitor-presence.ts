import { ApiError } from "@/lib/api";
import { postVisitorPresence } from "@/lib/chat-api";
import { isVisitorAuthExpired } from "@/lib/message-utils";
import { newTabId, sanitizePagePath } from "@/lib/presence-utils";

const HEARTBEAT_MS = 25_000;
/** Bounded backoff for failed initial registration only (ms). */
const INITIAL_RETRY_MS = [400, 800, 1_600, 3_200, 6_400] as const;

export type PresenceFailureKind = "auth" | "network" | "http" | "unknown";

export type PresenceFailure = {
  kind: PresenceFailureKind;
  status?: number;
  message: string;
  /** True while still inside the initial-registration retry budget. */
  willRetry: boolean;
};

export type PresenceController = {
  stop: () => void;
  setChatOpened: (open: boolean) => void;
  setPage: (page: string) => void;
  /** Host brand-page visibility (not the chat iframe / popup). */
  setHostVisible: (visible: boolean) => void;
  noteActivity: () => void;
  /** Force an immediate beat (e.g. after handshake / token refresh). */
  flush: () => void;
  get hostVisible(): boolean;
  get registered(): boolean;
};

function classifyFailure(error: unknown): Omit<PresenceFailure, "willRetry"> {
  if (error instanceof ApiError) {
    if (isVisitorAuthExpired(error.status)) {
      return { kind: "auth", status: error.status, message: error.message };
    }
    return { kind: "http", status: error.status, message: error.message };
  }
  if (error instanceof TypeError) {
    return { kind: "network", message: error.message || "Network error" };
  }
  if (error instanceof Error) {
    return { kind: "unknown", message: error.message };
  }
  return { kind: "unknown", message: "Presence request failed" };
}

/**
 * Heartbeats while the **host** page is visible.
 * Do not use the iframe's document.visibilityState — a closed popup can still
 * report the iframe document as hidden even when the brand page is foregrounded.
 */
export function startVisitorPresence(opts: {
  token: string;
  initialPage: string;
  chatOpened?: boolean;
  /** Defaults to true so the first upsert is not deferred waiting for postMessage. */
  hostVisible?: boolean;
  getToken?: () => string | null;
  heartbeatMs?: number;
  initialRetryMs?: readonly number[];
  /** Injected for tests. */
  postPresence?: typeof postVisitorPresence;
  onSuccess?: (info: {
    initial: boolean;
    durationMs: number;
    openConversationId?: string | null;
  }) => void;
  onError?: (failure: PresenceFailure) => void;
}): PresenceController {
  const tabId = newTabId();
  const post = opts.postPresence ?? postVisitorPresence;
  const interval = opts.heartbeatMs ?? HEARTBEAT_MS;
  const initialRetries = opts.initialRetryMs ?? INITIAL_RETRY_MS;
  let page = sanitizePagePath(opts.initialPage);
  let chatOpened = Boolean(opts.chatOpened);
  let hostVisible = opts.hostVisible ?? true;
  let activity = true;
  let stopped = false;
  let timer: number | null = null;
  let inFlight = false;
  let registered = false;
  let initialAttempt = 0;
  let authRenewRequested = false;

  const token = () => opts.getToken?.() ?? opts.token;

  const clearTimer = () => {
    if (timer != null) {
      window.clearTimeout(timer);
      timer = null;
    }
  };

  const scheduleNext = (delayMs: number) => {
    if (stopped) return;
    clearTimer();
    timer = window.setTimeout(() => {
      timer = null;
      void beat().finally(() => {
        if (stopped) return;
        if (registered) scheduleNext(interval);
        // Unregistered path schedules its own backoff from beat().
      });
    }, delayMs);
  };

  const beat = async () => {
    if (stopped || inFlight) return;
    if (!hostVisible) return;
    const t = token();
    if (!t) return;
    inFlight = true;
    const wasRegistered = registered;
    const started = typeof performance !== "undefined" ? performance.now() : Date.now();
    try {
      const presence = await post(t, {
        tab_id: tabId,
        page,
        chat_opened: chatOpened,
        activity,
      });
      activity = false;
      const initial = !wasRegistered;
      registered = true;
      initialAttempt = 0;
      authRenewRequested = false;
      const ended = typeof performance !== "undefined" ? performance.now() : Date.now();
      const openConversationId =
        presence && typeof presence === "object" && "open_conversation_id" in presence
          ? (presence as { open_conversation_id?: string | null }).open_conversation_id ?? null
          : null;
      opts.onSuccess?.({
        initial,
        durationMs: Math.round(ended - started),
        openConversationId,
      });
      if (!stopped && registered) scheduleNext(interval);
    } catch (error) {
      const base = classifyFailure(error);
      if (base.kind === "auth") {
        // One renew request — avoid retry loops / duplicate visitors.
        const willRetry = false;
        opts.onError?.({ ...base, willRetry });
        if (!authRenewRequested) {
          authRenewRequested = true;
        }
        clearTimer();
        return;
      }

      if (!registered) {
        const delay = initialRetries[Math.min(initialAttempt, initialRetries.length - 1)] ?? interval;
        initialAttempt += 1;
        const willRetry = initialAttempt <= initialRetries.length;
        opts.onError?.({ ...base, willRetry });
        if (willRetry) scheduleNext(delay);
        else scheduleNext(interval);
        return;
      }

      opts.onError?.({ ...base, willRetry: true });
      scheduleNext(interval);
    } finally {
      inFlight = false;
    }
  };

  // Immediate first upsert — do not wait for the interval.
  void beat();

  return {
    get hostVisible() {
      return hostVisible;
    },
    get registered() {
      return registered;
    },
    stop: () => {
      stopped = true;
      clearTimer();
    },
    flush: () => {
      activity = true;
      void beat();
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
