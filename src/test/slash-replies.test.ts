import { describe, expect, it } from "vitest";
import {
  detectSlashToken,
  filterSlashReplies,
  insertSlashReply,
} from "@/lib/slash-replies";
import { noteIncomingMessages, isNearBottom } from "@/lib/widget-auto-open";

describe("slash replies", () => {
  it("detects slash at start and after whitespace", () => {
    expect(detectSlashToken("/hel", 4)?.query).toBe("hel");
    expect(detectSlashToken("Hi /thanks", 10)?.query).toBe("thanks");
    expect(detectSlashToken("a/bc", 4)).toBeNull();
    expect(detectSlashToken(" /", 2)?.query).toBe("");
  });

  it("filters by shortcut, title, and body", () => {
    const replies = [
      { id: 1, title: "Greeting", shortcut: "/hello", body: "Hi there" },
      { id: 2, title: "Pricing", shortcut: "/pricing", body: "Our plans start at $9" },
    ];
    expect(filterSlashReplies(replies, "pric").map((r) => r.id)).toEqual([2]);
    expect(filterSlashReplies(replies, "hi there").map((r) => r.id)).toEqual([1]);
    expect(filterSlashReplies(replies, "hel").map((r) => r.id)).toEqual([1]);
    expect(filterSlashReplies(replies, "plans").map((r) => r.id)).toEqual([2]);
  });

  it("inserts reply while preserving surrounding draft text", () => {
    const draft = "Please see /pri more";
    const token = detectSlashToken("Please see /pri", 15)!;
    const { draft: next, cursor } = insertSlashReply(draft, { ...token, end: 15 }, "our pricing");
    expect(next).toBe("Please see our pricing more");
    expect(cursor).toBe("Please see our pricing".length);
  });
});

describe("widget auto-open dedup", () => {
  it("opens once per new agent message and ignores duplicates/history seed", () => {
    let known = new Set<number>();
    const seed = noteIncomingMessages(
      known,
      [
        { id: 1, sender_type: "agent" },
        { id: 2, sender_type: "visitor" },
      ],
      { seedOnly: true },
    );
    expect(seed.openForIds).toEqual([]);
    known = seed.knownIds;

    const first = noteIncomingMessages(known, [{ id: 3, sender_type: "agent" }]);
    expect(first.openForIds).toEqual([3]);
    known = first.knownIds;

    const dup = noteIncomingMessages(known, [{ id: 3, sender_type: "agent" }]);
    expect(dup.openForIds).toEqual([]);

    const visitorOnly = noteIncomingMessages(known, [{ id: 4, sender_type: "visitor" }]);
    expect(visitorOnly.openForIds).toEqual([]);
  });

  it("detects near-bottom scroll", () => {
    const el = {
      scrollHeight: 500,
      scrollTop: 400,
      clientHeight: 100,
    } as HTMLElement;
    expect(isNearBottom(el, 80)).toBe(true);
    el.scrollTop = 100;
    expect(isNearBottom(el, 80)).toBe(false);
  });
});
