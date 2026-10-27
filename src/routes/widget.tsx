import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Send, X } from "lucide-react";
import { brands } from "@/lib/sample-data";
import { addMessage, now, useLiveChats } from "@/lib/chat-store";
import { ApiError, isRealChatEnabled } from "@/lib/api";
import {
  createVisitorConversation,
  createVisitorSession,
  fetchVisitorMessages,
  fetchWidgetConfig,
  formatMsgTime,
  newClientMessageId,
  postVisitorMessage,
  type ApiMessage,
  type WidgetConfig,
} from "@/lib/chat-api";

export const Route = createFileRoute("/widget")({
  validateSearch: (s: Record<string, unknown>) => ({ brand: String(s["brand"] ?? ""), page: String(s["page"] ?? "/") }),
  head: () => ({
    meta: [
      { title: "Chat · BrandConnect widget" },
      { name: "description", content: "Live chat widget for brand websites." },
      { property: "og:title", content: "Chat · BrandConnect widget" },
      { property: "og:description", content: "Live chat widget for brand websites." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Widget,
});

const quick = ["Get a quote", "Talk to someone", "Opening hours"];
const SESSION_KEY = (publicId: string) => `bc_visitor_token_${publicId}`;
const CONV_KEY = (publicId: string) => `bc_conv_${publicId}`;

function Widget() {
  return isRealChatEnabled() ? <RealWidget /> : <DemoWidget />;
}

function closeParent() {
  const target = document.referrer ? (() => { try { return new URL(document.referrer).origin; } catch { return "*"; } })() : "*";
  window.parent.postMessage({ type: "bc:close", source: "brandconnect-widget" }, target);
}

function DemoWidget() {
  const { brand: publicId, page } = Route.useSearch();
  const brand = brands.find((b) => b.publicId === publicId);
  const [convId, setConvId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const chats = useLiveChats();
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const k = CONV_KEY(publicId);
    let id = localStorage.getItem(k);
    if (!id) { id = `live_${Math.random().toString(36).slice(2, 8)}`; localStorage.setItem(k, id); }
    setConvId(id);
  }, [publicId]);

  const conv = chats.find((c) => c.id === convId);
  const msgs = conv?.messages ?? [];
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [msgs.length]);

  if (!brand) return <div className="p-6 text-sm text-muted-foreground">This chat isn't set up. Check the brand ID in the install code.</div>;

  const send = (text: string) => {
    if (!text.trim() || !convId) return;
    addMessage(convId, { from: "visitor", text: text.trim(), time: now() }, {
      name: `Visitor #${convId.slice(-4).toUpperCase()}`, brand: brand.name, brandId: brand.id, page,
    });
    setDraft("");
  };

  return (
    <WidgetChrome
      name={brand.name}
      color={brand.color}
      draft={draft}
      setDraft={setDraft}
      onSend={send}
      onClose={closeParent}
      endRef={end}
      emptyHints={msgs.length === 0}
      greeting={`Hi there! 👋 Welcome to ${brand.name}. How can we help today?`}
      status={conv?.status}
      messages={msgs.map((m, i) => ({ key: String(i), from: m.from, text: m.text, time: m.time }))}
    />
  );
}

function RealWidget() {
  const { brand: publicId, page } = Route.useSearch();
  const [config, setConfig] = useState<WidgetConfig | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<ApiMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);
  const [sending, setSending] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  const bootstrap = useCallback(async () => {
    if (!publicId) {
      setError("Missing brand ID");
      setBooting(false);
      return;
    }
    setError(null);
    setBooting(true);
    try {
      const cfg = await fetchWidgetConfig(publicId);
      setConfig(cfg);

      let sessionToken = sessionStorage.getItem(SESSION_KEY(publicId));
      if (!sessionToken) {
        const session = await createVisitorSession(publicId);
        sessionToken = session.token;
        sessionStorage.setItem(SESSION_KEY(publicId), sessionToken);
      }
      setToken(sessionToken);

      let convId = sessionStorage.getItem(CONV_KEY(publicId));
      if (!convId) {
        const conv = await createVisitorConversation(sessionToken, { page });
        convId = conv.id;
        sessionStorage.setItem(CONV_KEY(publicId), convId);
      }
      setConversationId(convId);
      const list = await fetchVisitorMessages(sessionToken, convId);
      setMsgs(list);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Chat unavailable");
      setConfig(null);
    } finally {
      setBooting(false);
    }
  }, [publicId, page]);

  useEffect(() => { void bootstrap(); }, [bootstrap]);

  useEffect(() => {
    if (!token || !conversationId) return;
    const poll = window.setInterval(() => {
      void fetchVisitorMessages(token, conversationId, { after_id: msgs.at(-1)?.id })
        .then((incoming) => {
          if (!incoming.length) return;
          setMsgs((prev) => {
            const seen = new Set(prev.map((m) => m.id));
            const merged = [...prev];
            for (const m of incoming) {
              if (!seen.has(m.id)) merged.push(m);
            }
            return merged;
          });
        })
        .catch(() => { /* keep last good state */ });
    }, 3000);
    return () => window.clearInterval(poll);
  }, [token, conversationId, msgs]);

  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [msgs.length]);

  const send = async (text: string) => {
    if (!text.trim() || !token || !conversationId || sending) return;
    setSending(true);
    setError(null);
    const clientId = newClientMessageId();
    try {
      const msg = await postVisitorMessage(token, conversationId, clientId, text.trim());
      setMsgs((prev) => (prev.some((m) => m.id === msg.id || m.client_message_id === clientId) ? prev : [...prev, msg]));
      setDraft("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not send");
    } finally {
      setSending(false);
    }
  };

  if (booting) {
    return <div className="p-6 text-sm text-muted-foreground">Starting chat…</div>;
  }

  if (!config) {
    return (
      <div className="space-y-3 p-6 text-sm">
        <p className="text-muted-foreground">{error ?? "This chat isn't set up."}</p>
        <button type="button" className="underline" onClick={() => void bootstrap()}>Retry</button>
      </div>
    );
  }

  return (
    <>
      {error && (
        <div className="border-b bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
          {error}{" "}
          <button type="button" className="underline" onClick={() => void bootstrap()}>Retry</button>
        </div>
      )}
      <WidgetChrome
        name={config.name}
        color={config.color}
        draft={draft}
        setDraft={setDraft}
        onSend={(t) => void send(t)}
        onClose={closeParent}
        endRef={end}
        emptyHints={msgs.length === 0}
        greeting={config.greeting || `Hi there! Welcome to ${config.name}. How can we help today?`}
        messages={msgs.map((m) => ({
          key: String(m.id),
          from: m.sender_type,
          text: m.body,
          time: formatMsgTime(m.created_at),
        }))}
      />
    </>
  );
}

function WidgetChrome({
  name, color, draft, setDraft, onSend, onClose, endRef, emptyHints, greeting, messages, status,
}: {
  name: string;
  color: string;
  draft: string;
  setDraft: (v: string) => void;
  onSend: (text: string) => void;
  onClose: () => void;
  endRef: React.RefObject<HTMLDivElement | null>;
  emptyHints: boolean;
  greeting: string;
  messages: { key: string; from: string; text: string; time?: string }[];
  status?: string;
}) {
  return (
    <div className="flex h-screen flex-col bg-card text-card-foreground">
      <div className="flex items-center gap-3 p-4 text-primary-foreground" style={{ background: color }}>
        <div className="flex size-9 items-center justify-center rounded-full bg-background/25 font-semibold">{name[0]}</div>
        <div>
          <p className="font-semibold">{name}</p>
          <p className="text-xs opacity-90">Chat with our team</p>
        </div>
        <button aria-label="Close chat" className="ml-auto rounded p-1 hover:bg-background/20" onClick={onClose}><X className="size-5" /></button>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto bg-muted/30 p-4" aria-live="polite">
        <Bubble from="bot" text={greeting} />
        {emptyHints && (
          <div className="flex flex-wrap gap-2">
            {quick.map((q) => <button key={q} onClick={() => onSend(q)} className="rounded-full border bg-card px-3 py-1.5 text-sm hover:bg-muted">{q}</button>)}
          </div>
        )}
        {messages.map((m) => <Bubble key={m.key} from={m.from} text={m.text} time={m.time} />)}
        {status === "closed" && <p className="text-center text-xs text-muted-foreground">This chat was closed. Send a message to start again.</p>}
        <div ref={endRef} />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); onSend(draft); }} className="flex gap-2 border-t p-3">
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Type your message…" aria-label="Message" className="h-10 flex-1 rounded-full border bg-background px-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        <button type="submit" aria-label="Send" className="flex size-10 items-center justify-center rounded-full text-primary-foreground" style={{ background: color }}><Send className="size-4" /></button>
      </form>
      <p className="pb-2 text-center text-[10px] text-muted-foreground">Powered by BrandConnect</p>
    </div>
  );
}

function Bubble({ from, text, time }: { from: string; text: string; time?: string }) {
  const mine = from === "visitor";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm ${mine ? "bg-primary text-primary-foreground" : "border bg-card"}`}>
        {text}
        {time && <p className={`mt-1 text-[10px] ${mine ? "text-primary-foreground/70" : "text-muted-foreground"}`}>{time}</p>}
      </div>
    </div>
  );
}
