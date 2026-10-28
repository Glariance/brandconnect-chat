import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryStorage, storagePersistenceNotice } from "@/lib/safe-storage";
import {
  isVisitorAuthExpired,
  latestServerId,
  mergeMessages,
  PendingSendRegistry,
  pendingKey,
} from "@/lib/message-utils";
import { messageFromBroadcast, newClientMessageId, type ApiMessage } from "@/lib/chat-api";
import {
  createAgentEcho,
  createVisitorEcho,
  realtimeStatusLabel,
  startBoundedMessagePolling,
  subscribeToConversation,
  type EchoChannel,
  type EchoLike,
} from "@/lib/echo-client";
import { drainCatchUpAfter } from "@/lib/catch-up";
import * as api from "@/lib/api";

function msg(partial: Partial<ApiMessage> & Pick<ApiMessage, "id" | "body">): ApiMessage {
  return {
    conversation_id: "c1",
    client_message_id: `00000000-0000-4000-8000-${String(partial.id).padStart(12, "0")}`,
    sender_type: "visitor",
    created_at: "2026-01-01T00:00:00Z",
    ...partial,
  };
}

function makeEcho(overrides?: {
  subscribed?: (cb: () => void) => unknown;
  error?: (cb: (err: unknown) => void) => unknown;
}): { echo: EchoLike; channel: EchoChannel; getHandler: () => ((payload: unknown) => void) | null } {
  let handler: ((payload: unknown) => void) | null = null;
  const channel: EchoChannel = {
    listen: (_event, cb) => {
      handler = cb;
      return undefined;
    },
    stopListening: vi.fn(),
    subscribed: overrides?.subscribed,
    error: overrides?.error,
  };
  const echo: EchoLike = {
    private: () => channel,
    leave: vi.fn(),
    disconnect: vi.fn(),
    connector: {
      pusher: {
        connection: {
          bind: vi.fn(),
          unbind: vi.fn(),
        },
      },
    },
  };
  return { echo, channel, getHandler: () => handler };
}

describe("pending client_message_id stability", () => {
  it("reuses the same client id for retries of the same conversation text", () => {
    const registry = new PendingSendRegistry();
    const createId = vi.fn()
      .mockReturnValueOnce("11111111-1111-4111-8111-111111111111")
      .mockReturnValueOnce("22222222-2222-4222-8222-222222222222");

    const first = registry.ensure("conv-a", "hello", "agent", createId);
    registry.markFailed("conv-a", first.clientMessageId);
    const retry = registry.ensure("conv-a", "hello", "agent", createId);

    expect(retry.clientMessageId).toBe(first.clientMessageId);
    expect(createId).toHaveBeenCalledTimes(1);
    expect(pendingKey("conv-a", first.clientMessageId)).toBe(`conv-a:${first.clientMessageId}`);
  });

  it("preserves pending UUID across conversation switch away and back", () => {
    const registry = new PendingSendRegistry();
    const createId = vi.fn()
      .mockReturnValueOnce("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
      .mockReturnValueOnce("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");

    const failed = registry.ensure("c1", "retry me", "agent", createId);
    registry.markFailed("c1", failed.clientMessageId);

    // Switch away: do NOT clearConversation / clearAll (inbox/widget preserve pending).
    expect(registry.listFor("c1")).toHaveLength(1);

    // Switch back and retry — same client_message_id.
    const again = registry.ensure("c1", "retry me", "agent", createId);
    expect(again.clientMessageId).toBe(failed.clientMessageId);
    expect(createId).toHaveBeenCalledTimes(1);
  });

  it("clears pending only on confirm, discard, or identity reset", () => {
    const registry = new PendingSendRegistry();
    const a = registry.ensure("c1", "one", "visitor", () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    registry.ensure("c2", "two", "visitor", () => "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");

    expect(registry.listFor("c1")).toHaveLength(1);
    registry.confirm("c1", a.clientMessageId);
    expect(registry.listFor("c1")).toHaveLength(0);
    expect(registry.listFor("c2")).toHaveLength(1);

    const b = registry.listFor("c2")[0]!;
    registry.discard("c2", b.clientMessageId);
    expect(registry.listFor("c2")).toHaveLength(0);

    registry.ensure("c3", "three", "agent", () => "cccccccc-cccc-4ccc-8ccc-cccccccccccc");
    registry.clearAll();
    expect(registry.listFor("c3")).toHaveLength(0);
  });

  it("late send failure after switch updates pending but not the other conversation draft/error", () => {
    const registry = new PendingSendRegistry();
    const drafts = new Map<string, string>();
    let active = "c1";
    let error: string | null = null;

    const pending = registry.ensure("c1", "hello", "agent", () => "dddddddd-dddd-4ddd-8ddd-dddddddddddd");
    drafts.set("c1", "");
    drafts.set("c2", "draft for c2");

    // Switch away before the HTTP failure returns.
    active = "c2";

    registry.markFailed("c1", pending.clientMessageId);
    // Mirror inbox/widget late-failure guard.
    if (active === "c1") {
      drafts.set("c1", "hello");
      error = "Send failed";
    } else {
      drafts.set("c1", "hello");
    }

    expect(registry.get("c1", pending.clientMessageId)?.status).toBe("failed");
    expect(drafts.get("c2")).toBe("draft for c2");
    expect(error).toBeNull();
    expect(drafts.get("c1")).toBe("hello");
  });
});

describe("safe visitor storage", () => {
  it("uses in-memory mode and explains reload risk", () => {
    const storage = createMemoryStorage();
    expect(storage.mode).toBe("memory");
    storage.setItem("k", "v");
    expect(storage.getItem("k")).toBe("v");
    storage.removeItem("k");
    expect(storage.getItem("k")).toBeNull();
    expect(storagePersistenceNotice("memory")).toMatch(/will not survive a reload/i);
    expect(storagePersistenceNotice("session")).toBeNull();
  });
});

describe("expired visitor credentials", () => {
  it("treats 401/403 as expired session signals", () => {
    expect(isVisitorAuthExpired(401)).toBe(true);
    expect(isVisitorAuthExpired(403)).toBe(true);
    expect(isVisitorAuthExpired(422)).toBe(false);
  });
});

describe("message merge and pagination helpers", () => {
  it("merges by server id without duplicates and sorts ascending", () => {
    const merged = mergeMessages(
      [msg({ id: 2, body: "b" }), msg({ id: 1, body: "a" })],
      [msg({ id: 2, body: "b-updated" }), msg({ id: 3, body: "c" })],
    );
    expect(merged.map((m) => m.id)).toEqual([1, 2, 3]);
    expect(merged[1]?.body).toBe("b-updated");
    expect(latestServerId(merged)).toBe(3);
  });

  it("parses broadcast payloads and ignores foreign conversation ids at subscribe layer", () => {
    const parsed = messageFromBroadcast({
      message: msg({ id: 9, body: "hi", conversation_id: "c9" }),
    });
    expect(parsed?.id).toBe(9);
    expect(messageFromBroadcast(null)).toBeNull();
  });

  it("generates UUID-shaped client ids", () => {
    expect(newClientMessageId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});

describe("Echo null / rejected initialization", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("createAgentEcho and createVisitorEcho resolve null when Reverb key is missing", async () => {
    vi.spyOn(api, "reverbEnv").mockReturnValue({
      key: "",
      host: "localhost",
      port: 8081,
      scheme: "http",
    });

    await expect(createAgentEcho()).resolves.toBeNull();
    await expect(createVisitorEcho("tok")).resolves.toBeNull();
    expect(realtimeStatusLabel("polling")).toMatch(/polling/i);
  });

  it("createAgentEcho and createVisitorEcho resolve null when initialization rejects", async () => {
    vi.spyOn(api, "reverbEnv").mockImplementation(() => {
      throw new Error("echo env unavailable");
    });

    await expect(createAgentEcho()).resolves.toBeNull();
    await expect(createVisitorEcho("tok")).resolves.toBeNull();
  });

  it("bounded polling disposer clears the interval timer", () => {
    vi.useFakeTimers();
    const tick = vi.fn();
    const stop = startBoundedMessagePolling(tick, 1000);
    vi.advanceTimersByTime(3000);
    expect(tick).toHaveBeenCalledTimes(3);
    stop();
    vi.advanceTimersByTime(5000);
    expect(tick).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });
});

describe("catch-up drain and concurrent merge", () => {
  it("drains more than 100 missed messages across pages before complete", async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => msg({ id: i + 1, body: `m${i + 1}` }));
    const page2 = Array.from({ length: 25 }, (_, i) => msg({ id: 101 + i, body: `m${101 + i}` }));
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ data: page1, nextCursor: "cursor-2", prevCursor: null })
      .mockResolvedValueOnce({ data: page2, nextCursor: null, prevCursor: "cursor-2" });

    const onPage = vi.fn();
    const result = await drainCatchUpAfter(0, fetchPage, { onPage });

    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(fetchPage.mock.calls[0]?.[0]).toEqual({ after_id: 0 });
    expect(fetchPage.mock.calls[1]?.[0]).toEqual({ after_id: 0, cursor: "cursor-2" });
    expect(result.complete).toBe(true);
    expect(result.messages).toHaveLength(125);
    expect(result.messages[0]?.id).toBe(1);
    expect(result.messages.at(-1)?.id).toBe(125);
    expect(onPage).toHaveBeenCalledTimes(2);
  });

  it("does not claim complete when a page is empty but still has a next cursor (gap)", async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ data: [msg({ id: 1, body: "a" })], nextCursor: "more", prevCursor: null })
      .mockResolvedValueOnce({ data: [], nextCursor: "still-more", prevCursor: "more" });

    const result = await drainCatchUpAfter(0, fetchPage);
    expect(result.complete).toBe(false);
    expect(result.messages.map((m) => m.id)).toEqual([1]);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("stops without advancing past a failed page", async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ data: [msg({ id: 1, body: "a" })], nextCursor: "page-2", prevCursor: null })
      .mockRejectedValueOnce(new Error("network"));

    const result = await drainCatchUpAfter(0, fetchPage);
    expect(result.complete).toBe(false);
    expect(result.messages.map((m) => m.id)).toEqual([1]);
  });

  it("merges messages that arrive during subscription/catch-up with HTTP pages", async () => {
    let live: ApiMessage[] = [msg({ id: 10, body: "already loaded" })];
    const applyIncoming = (incoming: ApiMessage[]) => {
      live = mergeMessages(live, incoming);
    };

    // Realtime arrives while catch-up HTTP is in flight.
    applyIncoming([msg({ id: 12, body: "from echo during catch-up" })]);

    const result = await drainCatchUpAfter(10, async () => ({
      data: [msg({ id: 11, body: "from http" }), msg({ id: 12, body: "from http dup" })],
      nextCursor: null,
      prevCursor: null,
    }), {
      onPage: (pageMessages) => applyIncoming(pageMessages),
    });

    applyIncoming(result.messages);
    expect(live.map((m) => m.id)).toEqual([10, 11, 12]);
    expect(live.find((m) => m.id === 12)?.body).toBe("from http dup");
  });
});

describe("Echo subscription lifecycle", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs onSubscribed on channel subscribe, not merely socket connected", () => {
    const subscribedCbs: Array<() => void> = [];
    const connectedCbs: Array<() => void> = [];
    const onSubscribed = vi.fn();
    const onMessage = vi.fn();

    const channel: EchoChannel = {
      listen: vi.fn(),
      stopListening: vi.fn(),
      subscribed: (cb) => {
        subscribedCbs.push(cb);
        return undefined;
      },
    };
    const echo: EchoLike = {
      private: () => channel,
      leave: vi.fn(),
      disconnect: vi.fn(),
      connector: {
        pusher: {
          connection: {
            bind: (event, cb) => {
              if (event === "connected") connectedCbs.push(cb as () => void);
            },
            unbind: vi.fn(),
          },
        },
      },
    };

    subscribeToConversation(echo, "conv-1", { onMessage, onSubscribed });

    connectedCbs.forEach((cb) => cb());
    expect(onSubscribed).not.toHaveBeenCalled();

    subscribedCbs.forEach((cb) => cb());
    expect(onSubscribed).toHaveBeenCalledTimes(1);
  });

  it("callback invoked after cleanup has no effect", () => {
    const subscribedCbs: Array<() => void> = [];
    const { echo, getHandler } = makeEcho({
      subscribed: (cb) => {
        subscribedCbs.push(cb);
        return undefined;
      },
    });
    const onMessage = vi.fn();
    const onSubscribed = vi.fn();

    const sub = subscribeToConversation(echo, "conv-1", { onMessage, onSubscribed });
    expect(sub.active).toBe(true);

    sub.leave();
    expect(sub.active).toBe(false);
    expect(echo.leave).toHaveBeenCalledWith("conversations.conv-1");

    getHandler()?.({ message: msg({ id: 1, body: "late", conversation_id: "conv-1" }) });
    subscribedCbs.forEach((cb) => cb());
    expect(onMessage).not.toHaveBeenCalled();
    expect(onSubscribed).not.toHaveBeenCalled();
  });

  it("drops broadcast messages for a different conversation id", () => {
    const { echo, getHandler } = makeEcho();
    const onMessage = vi.fn();
    subscribeToConversation(echo, "conv-1", { onMessage });
    getHandler()?.({ message: msg({ id: 3, body: "other", conversation_id: "conv-OTHER" }) });
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("delivers matching conversation broadcasts while active", () => {
    const { echo, getHandler } = makeEcho();
    const onMessage = vi.fn();
    subscribeToConversation(echo, "conv-1", { onMessage });
    getHandler()?.({ message: msg({ id: 1, body: "ok", conversation_id: "conv-1" }) });
    expect(onMessage).toHaveBeenCalledTimes(1);
  });
});
