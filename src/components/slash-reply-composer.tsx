import { useEffect, useId, useRef, useState } from "react";
import {
  detectSlashToken,
  filterSlashReplies,
  insertSlashReply,
  type SlashReply,
  type SlashToken,
} from "@/lib/slash-replies";

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  replies: SlashReply[];
  placeholder?: string;
  disabled?: boolean;
  /** "input" for single-line (inbox); "textarea" for visitors DM. */
  as?: "input" | "textarea";
  className?: string;
  "aria-label"?: string;
};

/**
 * Composer with `/` saved-reply menu.
 * Enter selects a reply while the menu is open (does not send).
 * Focus is never forced onto this field by parent auto-open logic.
 */
export function SlashReplyComposer({
  value,
  onChange,
  onSend,
  replies,
  placeholder = "Type a reply, or / for saved replies",
  disabled,
  as = "input",
  className = "h-9 flex-1 rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  "aria-label": ariaLabel = "Message",
}: Props) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const [token, setToken] = useState<SlashToken | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);

  const fieldEl = () => (as === "textarea" ? textRef.current : inputRef.current);

  const filtered = token ? filterSlashReplies(replies, token.query) : [];
  const showMenu = menuOpen && token !== null && filtered.length > 0;

  useEffect(() => {
    setActiveIndex(0);
  }, [token?.query, token?.start]);

  const refreshToken = (draft: string, cursor: number) => {
    const next = detectSlashToken(draft, cursor);
    setToken(next);
    setMenuOpen(Boolean(next));
  };

  const applyReply = (reply: SlashReply) => {
    if (!token) return;
    const { draft, cursor } = insertSlashReply(value, token, reply.body);
    onChange(draft);
    setToken(null);
    setMenuOpen(false);
    requestAnimationFrame(() => {
      const el = fieldEl();
      if (!el) return;
      el.focus();
      el.setSelectionRange(cursor, cursor);
    });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (showMenu) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % filtered.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + filtered.length) % filtered.length);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const reply = filtered[activeIndex];
        if (reply) applyReply(reply);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMenuOpen(false);
        return;
      }
    }
    if (e.key === "Enter" && as === "input" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  const fieldProps = {
    value,
    disabled,
    placeholder,
    "aria-label": ariaLabel,
    "aria-autocomplete": "list" as const,
    "aria-controls": showMenu ? listId : undefined,
    "aria-expanded": showMenu,
    role: "combobox" as const,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const next = e.target.value;
      onChange(next);
      refreshToken(next, e.target.selectionStart ?? next.length);
    },
    onClick: (e: React.MouseEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const t = e.currentTarget;
      refreshToken(t.value, t.selectionStart ?? t.value.length);
    },
    onKeyUp: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const t = e.currentTarget;
      refreshToken(t.value, t.selectionStart ?? t.value.length);
    },
    onKeyDown,
    onBlur: () => {
      // Delay so mousedown/touch on option can fire first.
      window.setTimeout(() => setMenuOpen(false), 150);
    },
  };

  return (
    <div className="relative min-w-0 flex-1">
      {as === "textarea" ? (
        <textarea
          {...fieldProps}
          ref={textRef}
          rows={3}
          className={`${className} min-h-[4.5rem] py-2`}
        />
      ) : (
        <input {...fieldProps} ref={inputRef} type="text" className={className} />
      )}
      {showMenu && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Saved replies"
          className="absolute bottom-full left-0 z-50 mb-1 max-h-56 w-full min-w-[16rem] overflow-y-auto rounded-md border bg-card py-1 shadow-md"
        >
          {filtered.map((reply, i) => (
            <li key={reply.id} role="option" aria-selected={i === activeIndex}>
              <button
                type="button"
                className={`flex w-full flex-col gap-0.5 px-3 py-2 text-left text-sm hover:bg-muted ${i === activeIndex ? "bg-muted" : ""}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => applyReply(reply)}
                onTouchEnd={(e) => {
                  e.preventDefault();
                  applyReply(reply);
                }}
              >
                <span className="flex items-center gap-2">
                  <code className="text-xs text-accent-foreground">{reply.shortcut}</code>
                  <span className="font-medium">{reply.title}</span>
                </span>
                <span className="line-clamp-2 text-xs text-muted-foreground">{reply.body}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
