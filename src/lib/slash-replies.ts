/** Pure helpers for slash-command saved-reply insertion. */

export type SlashReply = {
  id: number;
  title: string;
  shortcut: string;
  body: string;
};

export type SlashToken = {
  /** Inclusive start index of the `/token` in the draft. */
  start: number;
  /** Exclusive end index (cursor). */
  end: number;
  /** Query text without leading slash. */
  query: string;
};

/**
 * Detect an active slash token at the cursor.
 * Triggers when `/` is at start of draft or after whitespace.
 */
export function detectSlashToken(draft: string, cursor: number): SlashToken | null {
  const pos = Math.max(0, Math.min(cursor, draft.length));
  const before = draft.slice(0, pos);
  const match = before.match(/(?:^|[\s])(\/[a-zA-Z0-9_-]*)$/);
  if (!match) return null;
  const token = match[1] ?? "";
  const start = before.length - token.length;
  return {
    start,
    end: pos,
    query: token.slice(1).toLowerCase(),
  };
}

export function filterSlashReplies(replies: SlashReply[], query: string): SlashReply[] {
  const q = query.trim().toLowerCase();
  if (!q) return replies;
  return replies.filter((r) => {
    const shortcut = r.shortcut.replace(/^\//, "").toLowerCase();
    const title = r.title.toLowerCase();
    const body = r.body.toLowerCase();
    return shortcut.includes(q) || title.includes(q) || body.includes(q);
  });
}

/**
 * Replace the slash token with the reply body. Preserves surrounding draft text.
 * Cursor moves to the end of the inserted body.
 */
export function insertSlashReply(
  draft: string,
  token: SlashToken,
  body: string,
): { draft: string; cursor: number } {
  const next = draft.slice(0, token.start) + body + draft.slice(token.end);
  return { draft: next, cursor: token.start + body.length };
}
