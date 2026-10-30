import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Send, X } from "lucide-react";
import { Btn } from "@/components/app-shell";
import {
  detectSlashToken,
  filterSlashReplies,
  insertSlashReply,
  type SlashReply,
  type SlashToken,
} from "@/lib/slash-replies";
import { decideComposerKey, sendShortcutLabel } from "@/lib/composer-keyboard";

const MIN_H = 110;
const MAX_H = 280;

export type AgentComposerProps = {
  title: string;
  subtitle?: string;
  onClose?: () => void;
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  replies: SlashReply[];
  sending?: boolean;
  error?: string | null;
  placeholder?: string;
  /** Hide the outer card chrome (e.g. embedded in Inbox panel). */
  embedded?: boolean;
};

/**
 * Shared Inbox / Live Visitors agent composer.
 * Ctrl/Cmd+Enter sends; Enter/Shift+Enter newline; slash menu Enter selects only.
 */
export function AgentComposer({
  title,
  subtitle,
  onClose,
  value,
  onChange,
  onSend,
  replies,
  sending = false,
  error = null,
  placeholder = "Write a message… Type / for saved replies",
  embedded = false,
}: AgentComposerProps) {
  const listId = useId();
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  const [token, setToken] = useState<SlashToken | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const sendHint = sendShortcutLabel();

  const filtered = token ? filterSlashReplies(replies, token.query) : [];
  const showMenu = menuOpen && token !== null && filtered.length > 0;
  const canSend = Boolean(value.trim()) && !sending;

  const refreshToken = (draft: string, cursor: number) => {
    const next = detectSlashToken(draft, cursor);
    setToken(next);
    setMenuOpen(Boolean(next));
  };

  const resize = () => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(MAX_H, Math.max(MIN_H, el.scrollHeight));
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > MAX_H ? "auto" : "hidden";
  };

  useLayoutEffect(() => {
    resize();
  }, [value]);

  useEffect(() => {
    setActiveIndex(0);
  }, [token?.query, token?.start]);

  const applyReply = (reply: SlashReply) => {
    if (!token) return;
    const { draft, cursor } = insertSlashReply(value, token, reply.body);
    onChange(draft);
    setToken(null);
    setMenuOpen(false);
    requestAnimationFrame(() => {
      const el = textRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(cursor, cursor);
      resize();
    });
  };

  const trySend = () => {
    if (!canSend) return;
    onSend();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const decision = decideComposerKey(
      {
        key: e.key,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        isComposing: e.nativeEvent.isComposing || composingRef.current,
        keyCode: e.keyCode,
      },
      { slashMenuOpen: showMenu },
    );

    switch (decision.action) {
      case "ignore":
        return;
      case "slash-nav": {
        e.preventDefault();
        setActiveIndex((i) => {
          if (!filtered.length) return 0;
          return decision.dir === "down"
            ? (i + 1) % filtered.length
            : (i - 1 + filtered.length) % filtered.length;
        });
        return;
      }
      case "slash-select": {
        e.preventDefault();
        const reply = filtered[activeIndex];
        if (reply) applyReply(reply);
        return;
      }
      case "slash-dismiss": {
        e.preventDefault();
        setMenuOpen(false);
        return;
      }
      case "send": {
        e.preventDefault();
        trySend();
        return;
      }
      case "newline":
        // Allow default newline insertion (including Shift+Enter).
        return;
      default:
        return;
    }
  };

  const body = (
    <div
      className={
        embedded
          ? "flex flex-col"
          : "flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm"
      }
      role={embedded ? undefined : "dialog"}
      aria-label={embedded ? undefined : `Message ${title}`}
    >
      {!embedded && (
        <div className="flex items-start gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-foreground">{title}</p>
            {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          {onClose && (
            <button
              type="button"
              aria-label="Close composer"
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={onClose}
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      )}

      {error && (
        <p className="border-b border-destructive/20 bg-destructive/10 px-4 py-2 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="relative px-3 pt-3">
        <textarea
          ref={textRef}
          value={value}
          disabled={sending}
          placeholder={placeholder}
          aria-label="Message"
          aria-autocomplete="list"
          aria-controls={showMenu ? listId : undefined}
          aria-expanded={showMenu}
          role="combobox"
          rows={4}
          className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2.5 text-sm text-foreground shadow-sm outline-none transition-[box-shadow,border-color] placeholder:text-muted-foreground focus-visible:border-violet-500 focus-visible:ring-2 focus-visible:ring-violet-500/40 disabled:opacity-60 dark:focus-visible:border-violet-400 dark:focus-visible:ring-violet-400/30"
          style={{ minHeight: MIN_H }}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
          }}
          onChange={(e) => {
            const next = e.target.value;
            onChange(next);
            refreshToken(next, e.target.selectionStart ?? next.length);
          }}
          onClick={(e) => {
            const t = e.currentTarget;
            refreshToken(t.value, t.selectionStart ?? t.value.length);
          }}
          onKeyUp={(e) => {
            const t = e.currentTarget;
            refreshToken(t.value, t.selectionStart ?? t.value.length);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => {
            window.setTimeout(() => setMenuOpen(false), 150);
          }}
        />

        {showMenu && (
          <ul
            id={listId}
            role="listbox"
            aria-label="Saved replies"
            className="absolute bottom-[calc(100%-0.25rem)] left-3 right-3 z-50 mb-1 max-h-56 overflow-y-auto rounded-lg border border-border bg-popover py-1 text-popover-foreground shadow-lg"
          >
            {filtered.map((reply, i) => (
              <li key={reply.id} role="option" aria-selected={i === activeIndex}>
                <button
                  type="button"
                  className={`flex w-full flex-col gap-0.5 px-3 py-2 text-left text-sm hover:bg-muted ${i === activeIndex ? "bg-muted" : ""}`}
                  onMouseDown={(ev) => ev.preventDefault()}
                  onClick={() => applyReply(reply)}
                  onTouchEnd={(ev) => {
                    ev.preventDefault();
                    applyReply(reply);
                  }}
                >
                  <span className="flex items-center gap-2">
                    <code className="text-xs text-violet-700 dark:text-violet-300">{reply.shortcut}</code>
                    <span className="font-medium">{reply.title}</span>
                  </span>
                  <span className="line-clamp-2 text-xs text-muted-foreground whitespace-pre-wrap">{reply.body}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 px-3 pb-3 pt-2">
        <p className="text-xs text-muted-foreground">
          / for saved replies · {sendHint}
        </p>
        <Btn
          type="button"
          className="ml-auto gap-1.5"
          disabled={!canSend}
          onClick={trySend}
        >
          <Send className="size-4" />
          {sending ? "Sending…" : "Send"}
        </Btn>
      </div>
    </div>
  );

  return body;
}
