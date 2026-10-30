/** Shared agent composer keyboard rules (Inbox + Live Visitors). */

export function isMacPlatform(userAgent = typeof navigator !== "undefined" ? navigator.userAgent : ""): boolean {
  return /Mac|iPhone|iPad|iPod/i.test(userAgent);
}

export function sendShortcutLabel(userAgent?: string): string {
  return isMacPlatform(userAgent) ? "⌘↵ to send" : "Ctrl+Enter to send";
}

export type ComposerKeyDecision =
  | { action: "ignore" }
  | { action: "newline" }
  | { action: "send" }
  | { action: "slash-nav"; dir: "up" | "down" }
  | { action: "slash-select" }
  | { action: "slash-dismiss" };

type KeyLike = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  isComposing?: boolean;
  keyCode?: number;
};

/**
 * Decide composer key behavior. Slash menu takes precedence over send.
 * Enter alone never sends (newline); Ctrl/Cmd+Enter sends when menu closed.
 */
export function decideComposerKey(
  e: KeyLike,
  opts: { slashMenuOpen: boolean },
): ComposerKeyDecision {
  if (e.isComposing || e.keyCode === 229) return { action: "ignore" };

  if (opts.slashMenuOpen) {
    if (e.key === "ArrowDown") return { action: "slash-nav", dir: "down" };
    if (e.key === "ArrowUp") return { action: "slash-nav", dir: "up" };
    if (e.key === "Escape") return { action: "slash-dismiss" };
    if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.altKey) {
      return { action: "slash-select" };
    }
    // Ctrl/Cmd+Enter while menu open: dismiss intent to send is ambiguous — select first if Enter without mod already handled.
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      return { action: "slash-select" };
    }
  }

  if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.altKey) {
    return { action: "send" };
  }
  if (e.key === "Enter") {
    return { action: "newline" };
  }
  return { action: "ignore" };
}
