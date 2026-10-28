import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Send, X } from "lucide-react";
import { brands } from "@/lib/sample-data";
import { addMessage, now, useLiveChats } from "@/lib/chat-store";
import { ApiError, isAbortError, isRealChatEnabled } from "@/lib/api";
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
import {
  createVisitorEcho,
  disconnectEcho,
  subscribeToConversation,
  type ConversationSubscription,
  type EchoLike,
} from "@/lib/echo-client";
import { isVisitorAuthExpired, latestServerId, mergeMessages, PendingSendRegistry } from "@/lib/message-utils";
import { createSafeStorage, storagePersistenceNotice, type SafeStorage } from "@/lib/safe-storage";

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
  const storageRef = useRef<SafeStorage | null>(null);
  if (!storageRef.current && typeof window !== "undefined") {
    storageRef.current = createSafeStorage();
  }

  const [config, setConfig] = useState<WidgetConfig | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<ApiMessage[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [storageNotice, setStorageNotice] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);
  const [sending, setSending] = useState(false);
  const [pendingTick, setPendingTick] = useState(0);
  const end = useRef<HTMLDivElement>(null);

  const pendingRef = useRef(new PendingSendRegistry());
  const tokenRef = useRef<string | null>(null);
  const convRef = useRef<string | null>(null);
  const msgsRef = useRef<ApiMessage[]>([]);
  const bootAbortRef = useRef<AbortController | null>(null);
  const echoRef = useRef<EchoLike | null>(null);
  const subRef = useRef<ConversationSubscription | null>(null);
  const genRef = useRef(0);
  const renewingRef = useRef(false);

  tokenRef.current = token;
  convRef.current = conversationId;
  msgsRef.current = msgs;

  const bumpPending = () => setPendingTick((n) => n + 1);

  const clearVisitorIdentity = useCallback((pid: string) => {
    const storage = storageRef.current;
    storage?.removeItem(SESSION_KEY(pid));
    storage?.removeItem(CONV_KEY(pid));
  }, []);

  const applyIncoming = useCallback((cid: string, incoming: ApiMessage[]) => {
    if (convRef.current !== cid) return;
    setMsgs((prev) => {
      const merged = mergeMessages(prev, incoming);
      for (const m of incoming) {
        if (m.client_message_id) pendingRef.current.confirm(cid, m.client_message_id);
      }
      return merged;
    });
    bumpPending();
  }, []);

  const startAnonymousSession = useCallback(async (pid: string, pagePath: string, signal?: AbortSignal, forceNew = false) => {
    const storage = storageRef.current ?? createSafeStorage();
    storageRef.current = storage;
    setStorageNotice(storagePersistenceNotice(storage.mode));

    if (forceNew) clearVisitorIdentity(pid);

    const cfg = await fetchWidgetConfig(pid, { signal });
    setConfig(cfg);

    let sessionToken = forceNew ? null : storage.getItem(SESSION_KEY(pid));
    if (!sessionToken) {
      const session = await createVisitorSession(pid, { signal });
      sessionToken = session.token;
      storage.setItem(SESSION_KEY(pid), sessionToken);
    }
    setToken(sessionToken);

    let convId = forceNew ? null : storage.getItem(CONV_KEY(pid));
    if (!convId) {
      const conv = await createVisitorConversation(sessionToken, { page: pagePath }, { signal });
      convId = conv.id;
      storage.setItem(CONV_KEY(pid), convId);
    }
    setConversationId(convId);

    const page = await fetchVisitorMessages(sessionToken, convId, {}, { signal });
    setMsgs(page.data);
    setOlderCursor(page.nextCursor);
    return { token: sessionToken, conversationId: convId };
  }, [clearVisitorIdentity]);

  const renewSession = useCallback(async (reason: string) => {
    if (!publicId || renewingRef.current) return;
    renewingRef.current = true;
    setError(`${reason} Starting a new anonymous session…`);
    subRef.current?.leave();
    subRef.current = null;
    disconnectEcho(echoRef.current);
    echoRef.current = null;
    pendingRef.current.clearAll();
    setMsgs([]);
    setOlderCursor(null);
    try {
      const ac = new AbortController();
      await startAnonymousSession(publicId, page, ac.signal, true);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not start a new session");
      setConfig(null);
    } finally {
      renewingRef.current = false;
      bumpPending();
    }
  }, [page, publicId, startAnonymousSession]);

  const handleApiFailure = useCallback(async (e: unknown) => {
    if (isAbortError(e)) return;
    if (e instanceof ApiError && isVisitorAuthExpired(e.status)) {
      await renewSession("Your chat session expired.");
      return;
    }
    setError(e instanceof ApiError ? e.message : "Chat unavailable");
  }, [renewSession]);

  const bootstrap = useCallback(async () => {
    if (!publicId) {
      setError("Missing brand ID");
      setBooting(false);
      return;
    }
    bootAbortRef.current?.abort();
    const ac = new AbortController();
    bootAbortRef.current = ac;
    genRef.current += 1;
    setError(null);
    setBooting(true);
    try {
      await startAnonymousSession(publicId, page, ac.signal, false);
    } catch (e) {
      if (e instanceof ApiError && isVisitorAuthExpired(e.status)) {
        try {
          await startAnonymousSession(publicId, page, ac.signal, true);
        } catch (e2) {
          await handleApiFailure(e2);
          setConfig(null);
        }
      } else {
        await handleApiFailure(e);
        if (!(e instanceof ApiError && isVisitorAuthExpired(e.status))) setConfig(null);
      }
    } finally {
      setBooting(false);
    }
  }, [handleApiFailure, page, publicId, startAnonymousSession]);

  useEffect(() => {
    void bootstrap();
    return () => bootAbortRef.current?.abort();
  }, [bootstrap]);

  useEffect(() => {
    if (!token || !conversationId) return;
    let cancelled = false;
    const cid = conversationId;
    const t = token;

    void createVisitorEcho(t).then((echo) => {
      if (cancelled || tokenRef.current !== t || convRef.current !== cid) {
        disconnectEcho(echo);
        return;
      }
      disconnectEcho(echoRef.current);
      echoRef.current = echo;
      subRef.current?.leave();
      subRef.current = subscribeToConversation(
        echo,
        cid,
        (msg) => applyIncoming(cid, [msg]),
        () => {
          const after = latestServerId(msgsRef.current);
          void fetchVisitorMessages(t, cid, after ? { after_id: after } : {})
            .then((page) => applyIncoming(cid, page.data))
            .catch((e) => void handleApiFailure(e));
        },
      );
    });

    return () => {
      cancelled = true;
      subRef.current?.leave();
      subRef.current = null;
      disconnectEcho(echoRef.current);
      echoRef.current = null;
    };
  }, [token, conversationId, applyIncoming, handleApiFailure]);

  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [msgs.length, pendingTick]);

  const loadOlder = async () => {
    if (!token || !conversationId || !olderCursor || loadingOlder) return;
    setLoadingOlder(true);
    const cid = conversationId;
    const t = token;
    try {
      const page = await fetchVisitorMessages(t, cid, { cursor: olderCursor });
      if (convRef.current !== cid) return;
      setMsgs((prev) => mergeMessages(page.data, prev));
      setOlderCursor(page.nextCursor);
    } catch (e) {
      await handleApiFailure(e);
    } finally {
      setLoadingOlder(false);
    }
  };

  const send = async (text: string) => {
    if (!text.trim() || !token || !conversationId || sending) return;
    const cid = conversationId;
    const t = token;
    const body = text.trim();
    const pending = pendingRef.current.ensure(cid, body, "visitor", newClientMessageId);
    bumpPending();
    setSending(true);
    setError(null);
    setDraft("");
    try {
      const msg = await postVisitorMessage(t, cid, pending.clientMessageId, body);
      if (convRef.current === cid) {
        pendingRef.current.confirm(cid, pending.clientMessageId);
        setMsgs((prev) => mergeMessages(prev, [msg]));
        bumpPending();
      }
    } catch (e) {
      if (isAbortError(e)) return;
      pendingRef.current.markFailed(cid, pending.clientMessageId);
      bumpPending();
      setDraft(body);
      if (e instanceof ApiError && isVisitorAuthExpired(e.status)) {
        await renewSession("Your chat session expired.");
      } else {
        setError(e instanceof ApiError ? e.message : "Could not send");
      }
    } finally {
      setSending(false);
    }
  };

  void pendingTick;
  const pendingForActive = conversationId ? pendingRef.current.listFor(conversationId) : [];

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

  const display = [
    ...msgs.map((m) => ({
      key: `m-${m.id}`,
      from: m.sender_type,
      text: m.body,
      time: formatMsgTime(m.created_at),
    })),
    ...pendingForActive.map((p) => ({
      key: `p-${p.clientMessageId}`,
      from: p.senderType,
      text: p.text,
      time: p.status === "failed" ? "failed" : "sending…",
    })),
  ];

  return (
    <>
      {(storageNotice || error) && (
        <div className="space-y-1 border-b bg-muted/40 px-3 py-2 text-xs" role="status">
          {storageNotice && <p className="text-muted-foreground">{storageNotice}</p>}
          {error && (
            <p className="text-destructive">
              {error}{" "}
              <button type="button" className="underline" onClick={() => void bootstrap()}>Retry</button>
              {" · "}
              <button type="button" className="underline" onClick={() => void renewSession("Starting fresh.")}>New session</button>
            </p>
          )}
        </div>
      )}
      {olderCursor && (
        <div className="border-b px-3 py-1 text-center">
          <button type="button" className="text-xs text-primary underline" disabled={loadingOlder} onClick={() => void loadOlder()}>
            {loadingOlder ? "Loading…" : "Load older messages"}
          </button>
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
        emptyHints={msgs.length === 0 && pendingForActive.length === 0}
        greeting={config.greeting || `Hi there! Welcome to ${config.name}. How can we help today?`}
        messages={display}
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
