import { afterEach, describe, expect, it, vi } from "vitest";
import { createVisitorArrivalTracker } from "@/lib/visitor-arrival-tracker";
import { formatArrivalToast } from "@/lib/visitor-arrival-notify";
import { decideComposerKey, sendShortcutLabel } from "@/lib/composer-keyboard";
import type { LiveVisitor } from "@/lib/presence-utils";

function visitor(partial: Partial<LiveVisitor> & Pick<LiveVisitor, "visitor_id">): LiveVisitor {
  return {
    brand_id: 1,
    brand_name: "Northwind Solar",
    label: `Visitor #${partial.visitor_id}`,
    page: "/pricing",
    first_seen_at: "2026-01-01T00:00:00Z",
    last_seen_at: "2026-01-01T00:01:00Z",
    status: "active",
    chat_opened: false,
    tab_count: 1,
    version: "2026-01-01T00:01:00Z",
    ...partial,
  };
}

describe("visitor arrival tracker", () => {
  it("does not alert for baseline hydrate", () => {
    const t = createVisitorArrivalTracker();
    const rows = [visitor({ visitor_id: 1 }), visitor({ visitor_id: 2 })];
    t.resetBaseline(rows);
    expect(t.noteRows(rows)).toEqual([]);
  });

  it("alerts once for HTTP-discovered arrival after baseline", () => {
    const t = createVisitorArrivalTracker();
    t.resetBaseline([visitor({ visitor_id: 1 })]);
    const neu = visitor({ visitor_id: 2, first_seen_at: "2026-01-01T00:02:00Z" });
    const a = t.noteRows([visitor({ visitor_id: 1 }), neu]);
    expect(a.map((v) => v.visitor_id)).toEqual([2]);
    expect(t.noteRows([visitor({ visitor_id: 1 }), neu])).toEqual([]);
  });

  it("alerts once for realtime appeared and ignores heartbeat updates", () => {
    const t = createVisitorArrivalTracker();
    t.resetBaseline([]);
    const v = visitor({ visitor_id: 9 });
    expect(t.noteUpdate(v, "appeared")?.visitor_id).toBe(9);
    expect(t.noteUpdate({ ...v, version: "2026-01-01T00:02:00Z", page: "/about" }, "updated")).toBeNull();
    expect(t.noteUpdate(v, "appeared")).toBeNull(); // same appearance key
  });

  it("alerts again after offline expiry then new visit", () => {
    const t = createVisitorArrivalTracker();
    const v1 = visitor({ visitor_id: 5, first_seen_at: "t1" });
    t.resetBaseline([v1]);
    expect(t.noteUpdate(v1, "offline")).toBeNull();
    const v2 = visitor({ visitor_id: 5, first_seen_at: "t2", version: "t2" });
    expect(t.noteUpdate(v2, "appeared")?.visitor_id).toBe(5);
  });

  it("filter/reconnect reset does not burst historical alerts", () => {
    const t = createVisitorArrivalTracker();
    t.resetBaseline([visitor({ visitor_id: 1 })]);
    t.resetBaseline([visitor({ visitor_id: 1 }), visitor({ visitor_id: 2 })]);
    expect(t.noteRows([visitor({ visitor_id: 1 }), visitor({ visitor_id: 2 })])).toEqual([]);
  });
});

describe("arrival toast copy", () => {
  it("formats themed toast", () => {
    expect(formatArrivalToast(visitor({ visitor_id: 1 }))).toBe(
      "New visitor · Northwind Solar · /pricing",
    );
  });
});

describe("composer keyboard", () => {
  it("Ctrl/Cmd+Enter sends; Enter and Shift+Enter are newlines", () => {
    expect(
      decideComposerKey(
        { key: "Enter", ctrlKey: true, metaKey: false, shiftKey: false, altKey: false },
        { slashMenuOpen: false },
      ),
    ).toEqual({ action: "send" });
    expect(
      decideComposerKey(
        { key: "Enter", ctrlKey: false, metaKey: true, shiftKey: false, altKey: false },
        { slashMenuOpen: false },
      ),
    ).toEqual({ action: "send" });
    expect(
      decideComposerKey(
        { key: "Enter", ctrlKey: false, metaKey: false, shiftKey: false, altKey: false },
        { slashMenuOpen: false },
      ),
    ).toEqual({ action: "newline" });
    expect(
      decideComposerKey(
        { key: "Enter", ctrlKey: false, metaKey: false, shiftKey: true, altKey: false },
        { slashMenuOpen: false },
      ),
    ).toEqual({ action: "newline" });
  });

  it("slash menu Enter selects and does not send", () => {
    expect(
      decideComposerKey(
        { key: "Enter", ctrlKey: false, metaKey: false, shiftKey: false, altKey: false },
        { slashMenuOpen: true },
      ),
    ).toEqual({ action: "slash-select" });
  });

  it("IME composition does not send", () => {
    expect(
      decideComposerKey(
        {
          key: "Enter",
          ctrlKey: true,
          metaKey: false,
          shiftKey: false,
          altKey: false,
          isComposing: true,
        },
        { slashMenuOpen: false },
      ),
    ).toEqual({ action: "ignore" });
  });

  it("adapts send hint for Mac", () => {
    expect(sendShortcutLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X)")).toContain("⌘");
    expect(sendShortcutLabel("Mozilla/5.0 (Windows NT 10.0)")).toContain("Ctrl");
  });
});

describe("visitor arrival sound prefs", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("distinguishes preferred enabled from unlocked state and handles blocked play", async () => {
    const { visitorArrivalSound } = await import("@/lib/visitor-arrival-sound");
    visitorArrivalSound.setPreferredEnabled(true);
    expect(visitorArrivalSound.getState().preferredEnabled).toBe(true);
    expect(visitorArrivalSound.getState().unlocked).toBe(false);

    const blocked = await visitorArrivalSound.playArrivalTone();
    expect(blocked === "blocked" || blocked === "unavailable" || blocked === "played").toBe(true);

    visitorArrivalSound.setPreferredEnabled(false);
    expect(await visitorArrivalSound.playArrivalTone()).toBe("muted");
  });
});
