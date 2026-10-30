import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { startVisitorPresence } from "@/lib/visitor-presence";

describe("startVisitorPresence registration", () => {
  it("posts immediately and uses short backoff on initial failure", async () => {
    vi.useFakeTimers();
    const posts: unknown[] = [];
    let failOnce = true;
    const onError = vi.fn();
    const onSuccess = vi.fn();

    const ctl = startVisitorPresence({
      token: "tok",
      initialPage: "/x",
      hostVisible: true,
      heartbeatMs: 25_000,
      initialRetryMs: [200, 400],
      onError,
      onSuccess,
      postPresence: async (_t, body) => {
        posts.push(body);
        if (failOnce) {
          failOnce = false;
          throw new ApiError(500, "boom");
        }
        return {
          visitor_id: 1,
          brand_id: 1,
          brand_name: "A",
          label: "V",
          page: "/",
          first_seen_at: null,
          last_seen_at: null,
          status: "active",
          chat_opened: false,
          tab_count: 1,
          version: "v",
        };
      },
    });

    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    expect(posts.length).toBe(1);
    expect(onError).toHaveBeenCalled();
    expect(onError.mock.calls[0]?.[0]).toMatchObject({ kind: "http", willRetry: true });

    await vi.advanceTimersByTimeAsync(200);
    await Promise.resolve();
    expect(posts.length).toBe(2);
    expect(onSuccess).toHaveBeenCalled();
    expect(ctl.registered).toBe(true);

    ctl.stop();
    vi.useRealTimers();
  });

  it("surfaces auth failures once without spinning retries", async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    let calls = 0;
    const ctl = startVisitorPresence({
      token: "tok",
      initialPage: "/",
      heartbeatMs: 25_000,
      initialRetryMs: [100, 100, 100],
      onError,
      postPresence: async () => {
        calls += 1;
        throw new ApiError(401, "expired");
      },
    });

    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    expect(calls).toBe(1);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ kind: "auth", willRetry: false }));

    await vi.advanceTimersByTimeAsync(5_000);
    await Promise.resolve();
    expect(calls).toBe(1);

    ctl.stop();
    vi.useRealTimers();
  });
});
