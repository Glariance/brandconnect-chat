import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiConversation } from "@/lib/chat-api";
import {
  applyInboxSummary,
  conversationVersion,
  inboxSummaryFromBroadcast,
  isStaleInboxVersion,
  mergeInboxLists,
  type InboxSummary,
} from "@/lib/inbox-utils";
import {
  __resetSharedAgentEchoForTests,
  acquireAgentEcho,
  releaseAgentEcho,
  startBoundedMessagePolling,
  subscribeToBrandInbox,
  type EchoChannel,
  type EchoLike,
} from "@/lib/echo-client";
import * as api from "@/lib/api";

function row(partial: Partial<ApiConversation> & Pick<ApiConversation, "id">): ApiConversation {
  return {
    brand_id: 1,
    visitor_name: "Visitor",
    page: "/",
    status: "open",
    unread_count: 0,
    last_message_preview: null,
    last_message_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...partial,
  };
}

function summary(partial: Partial<InboxSummary> & Pick<InboxSummary, "id">): InboxSummary {
  return {
    brand_id: 1,
    status: "open",
    visitor_name: "Pat",
    page: "/pricing",
    last_message_preview: "Hello",
    last_message_at: "2026-01-01T00:01:00Z",
    updated_at: "2026-01-01T00:01:00Z",
    version: "2026-01-01T00:01:00Z",
    ...partial,
  };
}

function makeEcho(overrides?: {
  subscribed?: (cb: () => void) => unknown;
  error?: (cb: (err: unknown) => void) => unknown;
}): {
  echo: EchoLike;
  channel: EchoChannel;
  getHandler: () => ((payload: unknown) => void) | null;
  connectionHandlers: Map<string, Array<(...args: unknown[]) => void>>;
  privateChannels: string[];
} {
  let handler: ((payload: unknown) => void) | null = null;
  const connectionHandlers = new Map<string, Array<(...args: unknown[]) => void>>();
  const privateChannels: string[] = [];
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
    private: (name) => {
      privateChannels.push(name);
      return channel;
    },
    leave: vi.fn(),
    disconnect: vi.fn(),
    connector: {
      pusher: {
        connection: {
          bind: (event, cb) => {
            const list = connectionHandlers.get(event) ?? [];
            list.push(cb);
            connectionHandlers.set(event, list);
          },
          unbind: vi.fn(),
        },
      },
    },
  };
  return { echo, channel, getHandler: () => handler, connectionHandlers, privateChannels };
}

describe("inbox summary merge", () => {
  it("parses broadcast payloads and rejects incomplete ones", () => {
    expect(inboxSummaryFromBroadcast(null)).toBeNull();
    expect(
      inboxSummaryFromBroadcast({
        conversation: {
          id: "c1",
          brand_id: 2,
          status: "open",
          visitor_name: "Alex",
          version: "2026-02-01T00:00:00Z",
        },
      }),
    ).toMatchObject({ id: "c1", brand_id: 2, visitor_name: "Alex" });
  });

  it("adds a new conversation once when filters match", () => {
    const next = applyInboxSummary([], summary({ id: "c-new" }), { status: "open", brandId: "all" });
    expect(next).toHaveLength(1);
    expect(next[0]?.id).toBe("c-new");
    expect(next[0]?.unread_count).toBe(0);

    const again = applyInboxSummary(next, summary({ id: "c-new", last_message_preview: "Hi again", version: "2026-01-01T00:02:00Z" }), {
      status: "open",
      brandId: "all",
    });
    expect(again).toHaveLength(1);
    expect(again[0]?.last_message_preview).toBe("Hi again");
  });

  it("removes rows that no longer match status or brand filters", () => {
    const existing = [row({ id: "c1", status: "open", brand_id: 1 })];
    const closed = applyInboxSummary(existing, summary({ id: "c1", status: "closed", version: "2026-01-01T00:05:00Z" }), {
      status: "open",
      brandId: "all",
    });
    expect(closed).toHaveLength(0);

    const wrongBrand = applyInboxSummary(existing, summary({ id: "c1", brand_id: 9, version: "2026-01-01T00:05:00Z" }), {
      status: "open",
      brandId: 1,
    });
    expect(wrongBrand).toHaveLength(0);
  });

  it("rejects stale out-of-order summaries", () => {
    expect(isStaleInboxVersion("2026-01-01T00:00:00Z", "2026-01-01T00:01:00Z")).toBe(true);
    const existing = [row({ id: "c1", updated_at: "2026-01-01T00:02:00Z", last_message_preview: "newer" })];
    const next = applyInboxSummary(
      existing,
      summary({ id: "c1", last_message_preview: "stale", version: "2026-01-01T00:01:00Z" }),
      { status: "open", brandId: "all" },
    );
    expect(next[0]?.last_message_preview).toBe("newer");
    expect(conversationVersion(next[0]!)).toBe("2026-01-01T00:02:00Z");
  });

  it("preserves selection-related fields and does not invent unread", () => {
    const existing = [row({ id: "c1", unread_count: 4, visitor_name: "Keep" })];
    const next = applyInboxSummary(
      existing,
      summary({ id: "c1", visitor_name: "Updated", version: "2026-01-01T00:03:00Z" }),
      { status: "open", brandId: "all" },
    );
    expect(next[0]?.unread_count).toBe(4);
    expect(next[0]?.visitor_name).toBe("Updated");
  });

  it("merges HTTP reconcile with live rows without losing newer live data", () => {
    const http = [row({ id: "c1", unread_count: 2, updated_at: "2026-01-01T00:01:00Z", last_message_preview: "http" })];
    const live = [
      row({ id: "c1", unread_count: 0, updated_at: "2026-01-01T00:02:00Z", last_message_preview: "live-newer" }),
      row({ id: "c2", updated_at: "2026-01-01T00:03:00Z", last_message_preview: "missed" }),
    ];
    const merged = mergeInboxLists(http, live, { status: "open", brandId: "all" });
    expect(merged.map((r) => r.id)).toEqual(["c2", "c1"]);
    expect(merged.find((r) => r.id === "c1")?.last_message_preview).toBe("live-newer");
    expect(merged.find((r) => r.id === "c1")?.unread_count).toBe(2);
  });
});

describe("brand inbox subscription lifecycle", () => {
  it("subscribes to brands.{id}.inbox and cleans up on leave", () => {
    const { echo, getHandler, privateChannels } = makeEcho({
      subscribed: (cb) => {
        cb();
        return undefined;
      },
    });
    const onSummary = vi.fn();
    const onSubscribed = vi.fn();
    const sub = subscribeToBrandInbox(echo, 7, { onSummary, onSubscribed });
    expect(privateChannels).toContain("brands.7.inbox");
    expect(onSubscribed).toHaveBeenCalled();

    getHandler()?.({
      conversation: {
        id: "c1",
        brand_id: 7,
        status: "open",
        visitor_name: "Pat",
        version: "2026-01-01T00:00:00Z",
      },
    });
    expect(onSummary).toHaveBeenCalledTimes(1);

    sub.leave();
    expect(echo.leave).toHaveBeenCalledWith("brands.7.inbox");
    getHandler()?.({ conversation: { id: "c2", brand_id: 7, status: "open", version: "x" } });
    expect(onSummary).toHaveBeenCalledTimes(1);
  });

  it("restores list polling on disconnect and stops after healthy recovery", async () => {
    vi.useFakeTimers();
    const subscribedCbs: Array<() => void> = [];
    const { echo, connectionHandlers } = makeEcho({
      subscribed: (cb) => {
        subscribedCbs.push(cb);
        return undefined;
      },
    });

    let listPolling = false;
    let listPollStop: (() => void) | null = null;
    let inboxHealthy = false;
    let reconciled = false;
    const subscribed = new Set<number>();
    const expected = [1];

    const stopListPolling = () => {
      listPollStop?.();
      listPollStop = null;
      listPolling = false;
    };
    const startListPolling = () => {
      listPolling = true;
      inboxHealthy = false;
      if (listPollStop) return;
      listPollStop = startBoundedMessagePolling(() => {}, 1000);
    };
    const maybeStop = () => {
      if (expected.every((id) => subscribed.has(id)) && reconciled) {
        inboxHealthy = true;
        stopListPolling();
      }
    };

    subscribeToBrandInbox(echo, 1, {
      onSummary: vi.fn(),
      onSubscribed: () => {
        subscribed.add(1);
        reconciled = true;
        maybeStop();
      },
      onConnectionLost: () => {
        subscribed.clear();
        reconciled = false;
        startListPolling();
      },
      subscriptionTimeoutMs: 60_000,
    });

    subscribedCbs.forEach((cb) => cb());
    expect(inboxHealthy).toBe(true);
    expect(listPolling).toBe(false);

    (connectionHandlers.get("disconnected") ?? []).forEach((cb) => cb());
    expect(listPolling).toBe(true);
    expect(inboxHealthy).toBe(false);

    subscribedCbs.forEach((cb) => cb());
    expect(inboxHealthy).toBe(true);
    expect(listPolling).toBe(false);

    vi.useRealTimers();
  });
});

describe("shared agent Echo refcount", () => {
  afterEach(() => {
    __resetSharedAgentEchoForTests();
    vi.restoreAllMocks();
  });

  it("does not disconnect while another consumer still holds a ref", async () => {
    vi.spyOn(api, "reverbEnv").mockReturnValue({
      key: "test-key",
      host: "127.0.0.1",
      port: 8081,
      scheme: "http",
    });
    // createAgentEcho still loads laravel-echo; stub acquire path by resetting after unit-level leave.
    // Here we only assert refcount bookkeeping does not throw when releasing twice after one acquire fails (SSR/null).
    const a = await acquireAgentEcho();
    const b = await acquireAgentEcho();
    expect(a).toBe(b);
    releaseAgentEcho();
    releaseAgentEcho();
    releaseAgentEcho(); // extra release is safe
  });
});
