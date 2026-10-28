import { describe, expect, it } from "vitest";
import {
  applyPresenceUpdate,
  liveVisitorFromBroadcast,
  mergePresenceLists,
  sanitizePagePath,
  type LiveVisitor,
} from "@/lib/presence-utils";

function visitor(partial: Partial<LiveVisitor> & Pick<LiveVisitor, "visitor_id">): LiveVisitor {
  return {
    brand_id: 1,
    brand_name: "Acme",
    label: `Visitor #${partial.visitor_id}`,
    page: "/",
    first_seen_at: "2026-01-01T00:00:00Z",
    last_seen_at: "2026-01-01T00:01:00Z",
    status: "active",
    chat_opened: false,
    tab_count: 1,
    version: "2026-01-01T00:01:00Z",
    ...partial,
  };
}

describe("presence utils", () => {
  it("sanitizes page paths", () => {
    expect(sanitizePagePath("/pricing?token=secret#x")).toBe("/pricing");
    expect(sanitizePagePath("https://ex.com/a/b?q=1")).toBe("/a/b");
    expect(sanitizePagePath(null)).toBe("/");
  });

  it("parses presence broadcasts and rejects incomplete payloads", () => {
    expect(liveVisitorFromBroadcast(null)).toBeNull();
    const parsed = liveVisitorFromBroadcast({
      reason: "appeared",
      visitor: {
        visitor_id: 9,
        brand_id: 2,
        label: "Visitor #9",
        page: "/x",
        status: "active",
        chat_opened: false,
        tab_count: 1,
        version: "2026-01-01T00:00:00Z",
      },
    });
    expect(parsed?.reason).toBe("appeared");
    expect(parsed?.visitor.visitor_id).toBe(9);
  });

  it("adds once, updates, and removes offline without inventing duplicates", () => {
    let rows = applyPresenceUpdate([], visitor({ visitor_id: 1 }), "appeared", { brandId: "all" });
    expect(rows).toHaveLength(1);
    rows = applyPresenceUpdate(
      rows,
      visitor({ visitor_id: 1, page: "/next", version: "2026-01-01T00:02:00Z" }),
      "updated",
      { brandId: "all" },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.page).toBe("/next");
    rows = applyPresenceUpdate(
      rows,
      visitor({ visitor_id: 1, status: "offline", version: "2026-01-01T00:03:00Z" }),
      "offline",
      { brandId: "all" },
    );
    expect(rows).toHaveLength(0);
  });

  it("rejects stale versions and brand filter mismatches", () => {
    const existing = [visitor({ visitor_id: 1, page: "newer", version: "2026-01-01T00:05:00Z" })];
    const stale = applyPresenceUpdate(
      existing,
      visitor({ visitor_id: 1, page: "stale", version: "2026-01-01T00:01:00Z" }),
      "updated",
      { brandId: "all" },
    );
    expect(stale[0]?.page).toBe("newer");

    const filtered = applyPresenceUpdate(
      existing,
      visitor({ visitor_id: 2, brand_id: 9, version: "2026-01-01T00:06:00Z" }),
      "appeared",
      { brandId: 1 },
    );
    expect(filtered).toHaveLength(1);
  });

  it("merges HTTP reconcile with live rows keeping newer versions", () => {
    const http = [visitor({ visitor_id: 1, version: "2026-01-01T00:01:00Z", last_seen_at: "2026-01-01T00:01:00Z", page: "http" })];
    const live = [
      visitor({ visitor_id: 1, version: "2026-01-01T00:02:00Z", last_seen_at: "2026-01-01T00:02:00Z", page: "live" }),
      visitor({ visitor_id: 2, version: "2026-01-01T00:03:00Z", last_seen_at: "2026-01-01T00:03:00Z", page: "missed" }),
    ];
    const merged = mergePresenceLists(http, live, { brandId: "all" });
    expect(merged.map((r) => r.visitor_id)).toEqual([2, 1]);
    expect(merged.find((r) => r.visitor_id === 1)?.page).toBe("live");
  });
});
