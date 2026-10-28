/**
 * Browser-only Laravel Echo / Reverb client.
 * Must never be imported at module top-level from SSR route modules without a
 * typeof window guard — call createAgentEcho / createVisitorEcho inside effects.
 */
import type { ApiMessage } from "@/lib/chat-api";
import { apiBaseUrl, reverbEnv, xsrfToken } from "@/lib/api";
import { messageFromBroadcast } from "@/lib/chat-api";

export type RealtimeStatus = "connecting" | "live" | "polling" | "unavailable";

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
};

/**
 * Subscribe to conversations.{id} / .message.created.
 * After leave(), message/subscribed callbacks are no-ops.
 */
export function subscribeToConversation(
  echo: EchoLike,
  conversationId: string,
  handlers: SubscribeHandlers,
): ConversationSubscription {
  let active = true;
  const channelName = `conversations.${conversationId}`;
  const channel = echo.private(channelName);

  const handler = (payload: unknown) => {
    if (!active) return;
    const msg = messageFromBroadcast(payload);
    if (msg && msg.conversation_id === conversationId) handlers.onMessage(msg);
  };

  channel.listen(".message.created", handler);

  const onSubscribed = () => {
    if (!active) return;
    handlers.onSubscribed?.();
  };
  const onError = (err: unknown) => {
    if (!active) return;
    handlers.onSubscriptionError?.(err);
  };

  channel.subscribed?.(onSubscribed);
  channel.error?.(onError);

  // Some Echo/Pusher builds expose subscription success only via the connection binder.
  // Also re-run catch-up when the socket reconnects *and* the channel is still active —
  // callers should still prefer onSubscribed; this is a safety net that only fires while active.
  const connection = echo.connector?.pusher?.connection;
  const onConnected = () => {
    if (!active) return;
    // Do not treat socket connected alone as subscribed; wait for channel.subscribed.
    // If the channel API lacks subscribed(), fall back so catch-up still runs once.
    if (typeof channel.subscribed !== "function") {
      handlers.onSubscribed?.();
    }
  };
  connection?.bind("connected", onConnected);

  return {
    get active() {
      return active;
    },
    leave: () => {
      if (!active) return;
      active = false;
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

/** Bounded message polling while realtime is unavailable. Returns a disposer. */
export function startBoundedMessagePolling(
  tick: () => void,
  intervalMs = 3000,
): () => void {
  const id = window.setInterval(tick, intervalMs);
  return () => window.clearInterval(id);
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
