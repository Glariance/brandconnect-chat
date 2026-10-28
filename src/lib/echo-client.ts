/**
 * Browser-only Laravel Echo / Reverb client.
 * Must never be imported at module top-level from SSR route modules without a
 * typeof window guard — call createAgentEcho / createVisitorEcho inside effects.
 */
import type { ApiMessage } from "@/lib/chat-api";
import { apiBaseUrl, reverbEnv, xsrfToken } from "@/lib/api";
import { messageFromBroadcast } from "@/lib/chat-api";

export type RealtimeStatus = "connecting" | "live" | "polling" | "unavailable";

export type ConnectionLostReason = "disconnected" | "unavailable" | "failed" | "timeout";

export type EchoChannel = {
  listen: (event: string, cb: (payload: unknown) => void) => unknown;
  stopListening: (event: string) => unknown;
  subscribed?: ((cb: () => void) => unknown) | undefined;
  error?: ((cb: (err: unknown) => void) => unknown) | undefined;
};

export type EchoLike = {
  private: (channel: string) => EchoChannel;
  leave: (channel: string) => void;
  disconnect: () => void;
  connector?: {
    pusher?: {
      connection?: {
        bind: (event: string, cb: (...args: unknown[]) => void) => void;
        unbind: (event: string, cb?: (...args: unknown[]) => void) => void;
        state?: string;
      };
    };
  };
};

type EchoMode = "agent" | "visitor";

async function loadEchoConstructor(): Promise<new (opts: Record<string, unknown>) => EchoLike> {
  const [{ default: Echo }, { default: Pusher }] = await Promise.all([
    import("laravel-echo"),
    import("pusher-js"),
  ]);
  (window as unknown as { Pusher: unknown }).Pusher = Pusher;
  return Echo as unknown as new (opts: Record<string, unknown>) => EchoLike;
}

function buildAuthorizer(mode: EchoMode, visitorToken?: string) {
  const base = apiBaseUrl();
  const endpoint =
    mode === "visitor"
      ? `${base}/api/v1/widget/broadcasting/auth`
      : `${base}/broadcasting/auth`;

  return (channel: { name: string }) => ({
    authorize: (socketId: string, callback: (error: Error | null, data: unknown) => void) => {
      const headers: Record<string, string> = {
        Accept: "application/json",
        "Content-Type": "application/json",
      };

      if (mode === "visitor") {
        if (visitorToken) headers["Authorization"] = `Bearer ${visitorToken}`;
      } else {
        const xsrf = xsrfToken();
        if (xsrf) headers["X-XSRF-TOKEN"] = xsrf;
      }

      fetch(endpoint, {
        method: "POST",
        credentials: mode === "visitor" ? "omit" : "include",
        headers,
        body: JSON.stringify({
          socket_id: socketId,
          channel_name: channel.name,
        }),
      })
        .then(async (res) => {
          const data = await res.json().catch(() => null);
          if (!res.ok) {
            throw new Error(`Broadcast auth failed (${res.status})`);
          }
          callback(null, data);
        })
        .catch((err: Error) => callback(err, null));
    },
  });
}

async function createEcho(mode: EchoMode, visitorToken?: string): Promise<EchoLike | null> {
  if (typeof window === "undefined") return null;
  const env = reverbEnv();
  if (!env.key) return null;

  try {
    const Echo = await loadEchoConstructor();
    const forceTLS = env.scheme === "https";

    return new Echo({
      broadcaster: "reverb",
      key: env.key,
      wsHost: env.host,
      wsPort: env.port,
      wssPort: env.port,
      forceTLS,
      enabledTransports: ["ws", "wss"],
      authorizer: buildAuthorizer(mode, visitorToken),
    });
  } catch {
    return null;
  }
}

export function createAgentEcho(): Promise<EchoLike | null> {
  return createEcho("agent").catch(() => null);
}

export function createVisitorEcho(token: string): Promise<EchoLike | null> {
  return createEcho("visitor", token).catch(() => null);
}

/** Ref-counted shared agent Echo so inbox + conversation cleanup cannot orphan each other. */
let sharedAgentEcho: EchoLike | null = null;
let sharedAgentPromise: Promise<EchoLike | null> | null = null;
let sharedAgentRefs = 0;

export async function acquireAgentEcho(): Promise<EchoLike | null> {
  sharedAgentRefs += 1;
  if (!sharedAgentPromise) {
    sharedAgentPromise = createAgentEcho().then((echo) => {
      sharedAgentEcho = echo;
      return echo;
    });
  }
  return sharedAgentPromise;
}

export function releaseAgentEcho(): void {
  sharedAgentRefs = Math.max(0, sharedAgentRefs - 1);
  if (sharedAgentRefs > 0) return;
  disconnectEcho(sharedAgentEcho);
  sharedAgentEcho = null;
  sharedAgentPromise = null;
}

/** Test helper — resets shared agent Echo bookkeeping. */
export function __resetSharedAgentEchoForTests(): void {
  sharedAgentEcho = null;
  sharedAgentPromise = null;
  sharedAgentRefs = 0;
}

export type ConversationSubscription = {
  leave: () => void;
  /** Whether leave() has already been called. */
  get active(): boolean;
};

export type SubscribeHandlers = {
  onMessage: (message: ApiMessage) => void;
  /** Fires after private-channel authorization/subscription succeeds (initial + resubscribe). */
  onSubscribed?: () => void;
  onSubscriptionError?: (error: unknown) => void;
  /** Socket disconnected / unavailable / failed, or subscription timeout. */
  onConnectionLost?: (reason: ConnectionLostReason) => void;
  /** Start HTTP fallback if channel.subscribed never fires. Default 10000ms. */
  subscriptionTimeoutMs?: number | undefined;
};

const CONNECTION_LOST_EVENTS = ["disconnected", "unavailable", "failed"] as const;

/**
 * Subscribe to conversations.{id} / .message.created.
 * After leave(), all callbacks are no-ops; handlers/timers are cleaned up.
 */
export function subscribeToConversation(
  echo: EchoLike,
  conversationId: string,
  handlers: SubscribeHandlers,
): ConversationSubscription {
  let active = true;
  let subscribedOnce = false;
  const channelName = `conversations.${conversationId}`;
  const channel = echo.private(channelName);
  const connection = echo.connector?.pusher?.connection;
  const timeoutMs = handlers.subscriptionTimeoutMs ?? 10_000;

  const handler = (payload: unknown) => {
    if (!active) return;
    const msg = messageFromBroadcast(payload);
    if (msg && msg.conversation_id === conversationId) handlers.onMessage(msg);
  };

  channel.listen(".message.created", handler);

  let subTimeout: number | null = null;

  const clearSubTimeout = () => {
    if (subTimeout != null) {
      window.clearTimeout(subTimeout);
      subTimeout = null;
    }
  };

  const onSubscribed = () => {
    if (!active) return;
    subscribedOnce = true;
    clearSubTimeout();
    handlers.onSubscribed?.();
  };
  const onError = (err: unknown) => {
    if (!active) return;
    handlers.onSubscriptionError?.(err);
  };

  const onConnected = () => {
    if (!active) return;
    // Do not treat socket connected alone as subscribed; wait for channel.subscribed.
    // If the channel API lacks subscribed(), fall back so catch-up still runs once.
    if (typeof channel.subscribed !== "function") {
      onSubscribed();
    }
  };

  const onConnectionLost = (reason: ConnectionLostReason) => {
    if (!active) return;
    handlers.onConnectionLost?.(reason);
  };

  connection?.bind("connected", onConnected);
  const lostHandlers: Array<[ConnectionLostReason, (...args: unknown[]) => void]> = [];
  for (const event of CONNECTION_LOST_EVENTS) {
    const fn = () => onConnectionLost(event);
    lostHandlers.push([event, fn]);
    connection?.bind(event, fn);
  }

  subTimeout = window.setTimeout(() => {
    subTimeout = null;
    if (!active || subscribedOnce) return;
    onConnectionLost("timeout");
  }, timeoutMs);

  // Register after timeout is initialized so sync subscribed() callbacks are safe.
  channel.subscribed?.(onSubscribed);
  channel.error?.(onError);

  return {
    get active() {
      return active;
    },
    leave: () => {
      if (!active) return;
      active = false;
      clearSubTimeout();
      try {
        channel.stopListening(".message.created");
      } catch {
        /* ignore */
      }
      try {
        echo.leave(channelName);
      } catch {
        /* ignore */
      }
      try {
        connection?.unbind("connected", onConnected);
      } catch {
        /* ignore */
      }
      for (const [event, fn] of lostHandlers) {
        try {
          connection?.unbind(event, fn);
        } catch {
          /* ignore */
        }
      }
    },
  };
}

export function disconnectEcho(echo: EchoLike | null | undefined): void {
  if (!echo) return;
  try {
    echo.disconnect();
  } catch {
    /* ignore */
  }
}

export type InboxSubscription = {
  leave: () => void;
  get active(): boolean;
  get brandId(): number;
};

export type InboxSubscribeHandlers = {
  onSummary: (payload: unknown) => void;
  onSubscribed?: () => void;
  onSubscriptionError?: (error: unknown) => void;
  onConnectionLost?: (reason: ConnectionLostReason) => void;
  subscriptionTimeoutMs?: number | undefined;
};

/**
 * Subscribe to private-brands.{brandId}.inbox / .inbox.conversation.updated.
 * Does not disconnect the shared Echo instance — only leaves this channel.
 */
export function subscribeToBrandInbox(
  echo: EchoLike,
  brandId: number,
  handlers: InboxSubscribeHandlers,
): InboxSubscription {
  let active = true;
  let subscribedOnce = false;
  const channelName = `brands.${brandId}.inbox`;
  const channel = echo.private(channelName);
  const connection = echo.connector?.pusher?.connection;
  const timeoutMs = handlers.subscriptionTimeoutMs ?? 10_000;

  const handler = (payload: unknown) => {
    if (!active) return;
    handlers.onSummary(payload);
  };

  channel.listen(".inbox.conversation.updated", handler);

  let subTimeout: number | null = null;

  const clearSubTimeout = () => {
    if (subTimeout != null) {
      window.clearTimeout(subTimeout);
      subTimeout = null;
    }
  };

  const onSubscribed = () => {
    if (!active) return;
    subscribedOnce = true;
    clearSubTimeout();
    handlers.onSubscribed?.();
  };
  const onError = (err: unknown) => {
    if (!active) return;
    handlers.onSubscriptionError?.(err);
  };

  const onConnected = () => {
    if (!active) return;
    if (typeof channel.subscribed !== "function") {
      onSubscribed();
    }
  };

  const onConnectionLost = (reason: ConnectionLostReason) => {
    if (!active) return;
    handlers.onConnectionLost?.(reason);
  };

  connection?.bind("connected", onConnected);
  const lostHandlers: Array<[ConnectionLostReason, (...args: unknown[]) => void]> = [];
  for (const event of CONNECTION_LOST_EVENTS) {
    const fn = () => onConnectionLost(event);
    lostHandlers.push([event, fn]);
    connection?.bind(event, fn);
  }

  subTimeout = window.setTimeout(() => {
    subTimeout = null;
    if (!active || subscribedOnce) return;
    onConnectionLost("timeout");
  }, timeoutMs);

  channel.subscribed?.(onSubscribed);
  channel.error?.(onError);

  return {
    get active() {
      return active;
    },
    get brandId() {
      return brandId;
    },
    leave: () => {
      if (!active) return;
      active = false;
      clearSubTimeout();
      try {
        channel.stopListening(".inbox.conversation.updated");
      } catch {
        /* ignore */
      }
      try {
        echo.leave(channelName);
      } catch {
        /* ignore */
      }
      try {
        connection?.unbind("connected", onConnected);
      } catch {
        /* ignore */
      }
      for (const [event, fn] of lostHandlers) {
        try {
          connection?.unbind(event, fn);
        } catch {
          /* ignore */
        }
      }
    },
  };
}

/**
 * Non-overlapping bounded polling. The next tick is scheduled only after the
 * previous tick settles. Returns a disposer that clears the pending timer.
 */
export function startBoundedMessagePolling(
  tick: () => void | Promise<void>,
  intervalMs = 3000,
): () => void {
  let stopped = false;
  let inFlight = false;
  let timer: number | null = null;

  const clearTimer = () => {
    if (timer != null) {
      window.clearTimeout(timer);
      timer = null;
    }
  };

  const schedule = () => {
    if (stopped) return;
    clearTimer();
    timer = window.setTimeout(() => {
      timer = null;
      void (async () => {
        if (stopped || inFlight) return;
        inFlight = true;
        try {
          await tick();
        } finally {
          inFlight = false;
          schedule();
        }
      })();
    }, intervalMs);
  };

  schedule();

  return () => {
    stopped = true;
    clearTimer();
  };
}

export function realtimeStatusLabel(status: RealtimeStatus): string {
  switch (status) {
    case "connecting":
      return "Connecting realtime…";
    case "live":
      return "Realtime connected";
    case "polling":
      return "Realtime unavailable · polling";
    case "unavailable":
      return "Realtime unavailable";
    default:
      return "";
  }
}
