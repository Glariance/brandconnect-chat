/**
 * Browser-only Laravel Echo / Reverb client.
 * Must never be imported at module top-level from SSR route modules without a
 * typeof window guard — call createAgentEcho / createVisitorEcho inside effects.
 */
import type { ApiMessage } from "@/lib/chat-api";
import { apiBaseUrl, reverbEnv, xsrfToken } from "@/lib/api";
import { messageFromBroadcast } from "@/lib/chat-api";

export type EchoLike = {
  private: (channel: string) => {
    listen: (event: string, cb: (payload: unknown) => void) => unknown;
    stopListening: (event: string) => unknown;
  };
  leave: (channel: string) => void;
  disconnect: () => void;
  connector?: {
    pusher?: {
      connection?: {
        bind: (event: string, cb: () => void) => void;
        unbind: (event: string, cb?: () => void) => void;
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
        if (visitorToken) headers.Authorization = `Bearer ${visitorToken}`;
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
}

export function createAgentEcho(): Promise<EchoLike | null> {
  return createEcho("agent");
}

export function createVisitorEcho(token: string): Promise<EchoLike | null> {
  return createEcho("visitor", token);
}

export type ConversationSubscription = {
  leave: () => void;
};

export function subscribeToConversation(
  echo: EchoLike,
  conversationId: string,
  onMessage: (message: ApiMessage) => void,
  onReconnect?: () => void,
): ConversationSubscription {
  const channelName = `conversations.${conversationId}`;
  const channel = echo.private(channelName);

  const handler = (payload: unknown) => {
    const msg = messageFromBroadcast(payload);
    if (msg && msg.conversation_id === conversationId) onMessage(msg);
  };

  channel.listen(".message.created", handler);

  const connection = echo.connector?.pusher?.connection;
  const reconnect = () => onReconnect?.();
  connection?.bind("connected", reconnect);

  return {
    leave: () => {
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
        connection?.unbind("connected", reconnect);
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
