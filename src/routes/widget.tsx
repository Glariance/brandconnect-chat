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
  realtimeStatusLabel,
  startBoundedMessagePolling,
  subscribeToConversation,
  type ConversationSubscription,
  type EchoLike,
  type RealtimeStatus,
} from "@/lib/echo-client";
import { drainCatchUpAfter, HttpSyncWatermark } from "@/lib/catch-up";
import { isVisitorAuthExpired, latestServerId, mergeMessages, PendingSendRegistry } from "@/lib/message-utils";
import { createSafeStorage, storagePersistenceNotice, type SafeStorage } from "@/lib/safe-storage";
import { startVisitorPresence, type PresenceController, type PresenceFailure } from "@/lib/visitor-presence";
import { sanitizePagePath } from "@/lib/presence-utils";
import {
  presenceDiagEnabled,
  presenceDiagMark,
  presenceDiagReset,
  presenceDiagSnapshot,
  subscribePresenceDiag,
  type PresenceDiagEvent,
} from "@/lib/presence-diag";

export const Route = createFileRoute("/widget")({
  validateSearch: (s: Record<string, unknown>) => ({
    brand: String(s["brand"] ?? ""),
    page: String(s["page"] ?? "/"),
    // Boolean avoids TanStack JSON-encoding strings as diag=%221%22 in the URL.
    diag: s["diag"] === true || s["diag"] === 1 || s["diag"] === "1" || s["diag"] === "true",
  }),
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

function PresenceDiagPanel({
  events,
  presenceError,
  registered,
  chatOpened,
  pagePath,
}: {
  events: PresenceDiagEvent[];
  presenceError: string | null;
  registered: boolean;
  chatOpened: boolean;
  pagePath: string;
}) {
  return (
    <div
      className="max-h-48 overflow-y-auto border-b border-amber-500/40 bg-amber-50 px-2 py-1 font-mono text-[10px] text-amber-950"
      role="status"
      data-testid="presence-diag"
    >
      <p className="font-semibold">
        Presence diag · registered={String(registered)} · chat={chatOpened ? "open" : "closed"} · page={pagePath}
      </p>
      {presenceError && <p className="text-red-700">err: {presenceError}</p>}
      <ul className="mt-1 space-y-0.5">
        {events.map((e, i) => (
          <li key={`${e.t}-${e.stage}-${i}`}>
            +{e.t}ms {e.stage}{e.detail ? ` · ${e.detail}` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
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
  const { brand: publicId, page, diag: diagParam } = Route.useSearch();
  const showDiag = presenceDiagEnabled(diagParam);
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
  const [realtime, setRealtime] = useState<RealtimeStatus>("unavailable");
  const [pagePath, setPagePath] = useState(() => sanitizePagePath(page));
  const [chatOpened, setChatOpened] = useState(false);
  const [presenceError, setPresenceError] = useState<string | null>(null);
  const [presenceRegistered, setPresenceRegistered] = useState(false);
  const [diagEvents, setDiagEvents] = useState<PresenceDiagEvent[]>([]);
  const end = useRef<HTMLDivElement>(null);

  const pendingRef = useRef(new PendingSendRegistry());
  const tokenRef = useRef<string | null>(null);
  const convRef = useRef<string | null>(null);
  const msgsRef = useRef<ApiMessage[]>([]);
  const syncWatermarkRef = useRef(new HttpSyncWatermark());
  const bootAbortRef = useRef<AbortController | null>(null);
  const echoRef = useRef<EchoLike | null>(null);
  const subRef = useRef<ConversationSubscription | null>(null);
  const pollStopRef = useRef<(() => void) | null>(null);
  const presenceRef = useRef<PresenceController | null>(null);
  const parentOriginRef = useRef<string | null>(null);
  const chatOpenedRef = useRef(false);
  const hostVisibleRef = useRef(true);
  const lastHostPageRef = useRef<string | null>(null);
  const channelReadyRef = useRef(false);
  const genRef = useRef(0);
  const renewingRef = useRef(false);
  const ensuringConvRef = useRef(false);
  const presenceAuthRenewRef = useRef(false);
  const renewSessionRef = useRef<((reason: string) => Promise<void>) | null>(null);

  tokenRef.current = token;
  convRef.current = conversationId;
  msgsRef.current = msgs;
  chatOpenedRef.current = chatOpened;

  const bumpPending = () => setPendingTick((n) => n + 1);

  const clearVisitorIdentity = useCallback((pid: string) => {
    const storage = storageRef.current;
    storage?.removeItem(SESSION_KEY(pid));
    storage?.removeItem(CONV_KEY(pid));
  }, []);

  const applyIncoming = useCallback((cid: string, incoming: ApiMessage[]) => {
    // Echo / display merge only — does not advance HTTP sync watermark.
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

  const runCatchUp = useCallback(async (cid: string, tokenValue: string, signal?: AbortSignal): Promise<{ complete: boolean }> => {
    const afterId = syncWatermarkRef.current.current;
    if (afterId == null) {
      try {
        const page = await fetchVisitorMessages(tokenValue, cid, {}, { signal });
        if (convRef.current !== cid) return { complete: false };
        applyIncoming(cid, page.data);
        syncWatermarkRef.current.reset(latestServerId(page.data));
        return { complete: true };
      } catch (e) {
        if (!isAbortError(e)) await handleApiFailureRef.current?.(e);
        return { complete: false };
      }
    }
    const result = await drainCatchUpAfter(
      afterId,
      (params) => fetchVisitorMessages(tokenValue, cid, params, { signal }),
      {
        signal,
        onPage: (pageMessages) => {
          if (convRef.current !== cid) return;
          applyIncoming(cid, pageMessages);
        },
      },
    );
    if (convRef.current !== cid) return { complete: false };
    syncWatermarkRef.current.advanceFromHttp(result.confirmedThroughId);
    if (result.messages.length) applyIncoming(cid, result.messages);
    return { complete: result.complete };
  }, [applyIncoming]);

  const handleApiFailureRef = useRef<((e: unknown) => Promise<void>) | null>(null);

  const onPresenceFailure = useCallback(async (failure: PresenceFailure) => {
    presenceDiagMark("presence_err", `${failure.kind}:${failure.status ?? ""} ${failure.message}`.trim());
    setPresenceError(failure.message);
    if (failure.kind !== "auth") return;
    if (presenceAuthRenewRef.current || renewingRef.current) return;
    presenceAuthRenewRef.current = true;
    await renewSessionRef.current?.("Presence session expired.");
  }, []);

  const startAnonymousSession = useCallback(async (pid: string, currentPage: string, signal?: AbortSignal, forceNew = false) => {
    const storage = storageRef.current ?? createSafeStorage();
    storageRef.current = storage;
    setStorageNotice(storagePersistenceNotice(storage.mode));
    presenceDiagReset();
    presenceDiagMark("widget_mount", forceNew ? "forceNew" : "resume");

    if (forceNew) clearVisitorIdentity(pid);

    const cfg = await fetchWidgetConfig(pid, { signal });
    presenceDiagMark("config", cfg.public_id);
    setConfig(cfg);

    // Eager visitor identity for presence — no conversation until first message / chat start.
    let sessionToken = forceNew ? null : storage.getItem(SESSION_KEY(pid));
    let issuedNew = false;
    if (!sessionToken) {
      const session = await createVisitorSession(pid, { signal });
      sessionToken = session.token;
      storage.setItem(SESSION_KEY(pid), sessionToken);
      issuedNew = true;
    }
    presenceDiagMark("session", issuedNew ? "issued" : "storage");
    setToken(sessionToken);
    setPagePath(sanitizePagePath(currentPage));
    presenceAuthRenewRef.current = false;
    setPresenceRegistered(false);

    presenceRef.current?.stop();
    presenceDiagMark("presence_start");
    const initialPage = lastHostPageRef.current ?? currentPage;
    presenceRef.current = startVisitorPresence({
      token: sessionToken,
      initialPage,
      chatOpened: chatOpenedRef.current,
      hostVisible: hostVisibleRef.current,
      getToken: () => tokenRef.current,
      onSuccess: ({ initial }) => {
        setPresenceError(null);
        setPresenceRegistered(true);
        presenceDiagMark("presence_ok", initial ? "initial" : "heartbeat");
      },
      onError: (failure) => {
        void onPresenceFailure(failure);
      },
    });

    // Conversation is created/resumed on first message or when the popup opens with a prior thread.
    setConversationId(null);
    setMsgs([]);
    setOlderCursor(null);
    syncWatermarkRef.current.reset(undefined);

    return { token: sessionToken, conversationId: null as string | null };
  }, [clearVisitorIdentity, onPresenceFailure]);

  const ensureConversation = useCallback(async (sessionToken: string, currentPage: string, signal?: AbortSignal): Promise<string> => {
    if (convRef.current) return convRef.current;
    if (ensuringConvRef.current) {
      // Wait briefly for an in-flight ensure.
      for (let i = 0; i < 40 && ensuringConvRef.current; i++) {
        await new Promise((r) => setTimeout(r, 50));
        if (convRef.current) return convRef.current;
      }
    }
    ensuringConvRef.current = true;
    try {
      if (convRef.current) return convRef.current;
      const storage = storageRef.current ?? createSafeStorage();
      storageRef.current = storage;
      // POST resumes the latest open conversation or creates one — never from page visit alone.
      const conv = await createVisitorConversation(sessionToken, { page: sanitizePagePath(currentPage) }, { signal });
      if (publicId) storage.setItem(CONV_KEY(publicId), conv.id);
      setConversationId(conv.id);
      const pageMsgs = await fetchVisitorMessages(sessionToken, conv.id, {}, { signal });
      setMsgs(pageMsgs.data);
      setOlderCursor(pageMsgs.nextCursor);
      syncWatermarkRef.current.reset(latestServerId(pageMsgs.data));
      return conv.id;
    } finally {
      ensuringConvRef.current = false;
    }
  }, [publicId]);

  const renewSession = useCallback(async (reason: string) => {
    if (!publicId || renewingRef.current) return;
    renewingRef.current = true;
    setError(`${reason} Starting a new anonymous session…`);
    pollStopRef.current?.();
    pollStopRef.current = null;
    channelReadyRef.current = false;
    subRef.current?.leave();
    subRef.current = null;
    disconnectEcho(echoRef.current);
    echoRef.current = null;
    presenceRef.current?.stop();
    presenceRef.current = null;
    // Identity reset — drop pending sends for the old visitor.
    pendingRef.current.clearAll();
    setMsgs([]);
    setOlderCursor(null);
    setConversationId(null);
    syncWatermarkRef.current.reset(undefined);
    setRealtime("unavailable");
    try {
      const ac = new AbortController();
      await startAnonymousSession(publicId, pagePath, ac.signal, true);
      setError(null);
      setPresenceError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not start a new session");
      setConfig(null);
      setRealtime("unavailable");
    } finally {
      renewingRef.current = false;
      bumpPending();
    }
  }, [pagePath, publicId, startAnonymousSession]);

  renewSessionRef.current = renewSession;

  const handleApiFailure = useCallback(async (e: unknown) => {
    if (isAbortError(e)) return;
    if (e instanceof ApiError && isVisitorAuthExpired(e.status)) {
      await renewSession("Your chat session expired.");
      return;
    }
    setError(e instanceof ApiError ? e.message : "Chat unavailable");
  }, [renewSession]);

  handleApiFailureRef.current = handleApiFailure;

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
    return () => {
      bootAbortRef.current?.abort();
      presenceRef.current?.stop();
      presenceRef.current = null;
    };
  }, [bootstrap]);

  useEffect(() => {
    if (!showDiag) return;
    setDiagEvents(presenceDiagSnapshot());
    return subscribePresenceDiag(() => setDiagEvents(presenceDiagSnapshot()));
  }, [showDiag]);

  // Parent loader messages + ready handshake (listener before ready signal).
  useEffect(() => {
    presenceDiagMark("listener_ready");

    const applyHostState = (data: Record<string, unknown>) => {
      if (typeof data["parentOrigin"] === "string") {
        parentOriginRef.current = data["parentOrigin"];
      }
      if (typeof data["page"] === "string") {
        const next = sanitizePagePath(data["page"]);
        lastHostPageRef.current = next;
        setPagePath(next);
        presenceRef.current?.setPage(next);
        presenceDiagMark("page", next);
      }
      if (typeof data["open"] === "boolean") {
        const opened = Boolean(data["open"]);
        setChatOpened(opened);
        chatOpenedRef.current = opened;
        presenceRef.current?.setChatOpened(opened);
        presenceDiagMark("chat_state", opened ? "open" : "closed");
      }
      if (typeof data["visible"] === "boolean") {
        const visible = Boolean(data["visible"]);
        hostVisibleRef.current = visible;
        presenceRef.current?.setHostVisible(visible);
        presenceDiagMark("host_visibility", visible ? "visible" : "hidden");
      }
      if (typeof data["loaderBootMs"] === "number") {
        presenceDiagMark("handshake_ack", `loaderBootMs=${Math.round(data["loaderBootMs"])}`);
      }
      presenceRef.current?.flush();
    };

    const onMessage = (e: MessageEvent) => {
      const data = e.data;
      if (!data || typeof data !== "object") return;
      if ((data as { source?: string }).source !== "brandconnect-loader") return;
      // Only accept messages from the embedding parent window.
      if (e.source !== window.parent) return;
      if (parentOriginRef.current && e.origin !== parentOriginRef.current) return;
      if (!parentOriginRef.current) parentOriginRef.current = e.origin;

      const type = (data as { type?: string }).type;
      if (type === "bc:parent-origin") {
        if (typeof (data as { parentOrigin?: string }).parentOrigin === "string") {
          parentOriginRef.current = (data as { parentOrigin: string }).parentOrigin;
        }
        return;
      }
      if (type === "bc:host-state") {
        applyHostState(data as Record<string, unknown>);
        return;
      }
      if (type === "bc:page" && typeof (data as { page?: string }).page === "string") {
        const next = sanitizePagePath((data as { page: string }).page);
        lastHostPageRef.current = next;
        setPagePath(next);
        presenceRef.current?.setPage(next);
        presenceDiagMark("page", next);
        return;
      }
      if (type === "bc:chat-state" && typeof (data as { open?: boolean }).open === "boolean") {
        const opened = Boolean((data as { open: boolean }).open);
        setChatOpened(opened);
        chatOpenedRef.current = opened;
        presenceRef.current?.setChatOpened(opened);
        presenceDiagMark("chat_state", opened ? "open" : "closed");
        return;
      }
      if (type === "bc:host-visibility" && typeof (data as { visible?: boolean }).visible === "boolean") {
        const visible = Boolean((data as { visible: boolean }).visible);
        hostVisibleRef.current = visible;
        presenceRef.current?.setHostVisible(visible);
        presenceDiagMark("host_visibility", visible ? "visible" : "hidden");
      }
    };

    window.addEventListener("message", onMessage);

    // Signal loader only after the listener is installed so host state is not missed.
    try {
      const target =
        parentOriginRef.current
        ?? (document.referrer ? new URL(document.referrer).origin : "*");
      window.parent.postMessage(
        { type: "bc:widget-ready", source: "brandconnect-widget" },
        target,
      );
      presenceDiagMark("handshake_sent", typeof target === "string" ? target : "*");
    } catch {
      presenceDiagMark("handshake_sent", "failed");
    }

    return () => window.removeEventListener("message", onMessage);
  }, []);

  // When the popup opens with a prior CONV_KEY, resume that conversation for the same visitor.
  useEffect(() => {
    if (!chatOpened || !token || !publicId || conversationId) return;
    const stored = storageRef.current?.getItem(CONV_KEY(publicId));
    if (!stored) return;
    let cancelled = false;
    void (async () => {
      try {
        await ensureConversation(token, pagePath);
      } catch (e) {
        if (!cancelled) await handleApiFailureRef.current?.(e);
      }
    })();
    return () => { cancelled = true; };
  }, [chatOpened, token, publicId, conversationId, pagePath, ensureConversation]);

  useEffect(() => {
    if (!token || !conversationId) return;
    let cancelled = false;
    const cid = conversationId;
    const t = token;
    setRealtime("connecting");
    channelReadyRef.current = false;

    const stopPollingAfterRecovery = () => {
      pollStopRef.current?.();
      pollStopRef.current = null;
    };

    const startPollingFallback = () => {
      if (cancelled || convRef.current !== cid) return;
      setRealtime("polling");
      if (pollStopRef.current) return;
      pollStopRef.current = startBoundedMessagePolling(async () => {
        if (cancelled || convRef.current !== cid || tokenRef.current !== t) return;
        try {
          const { complete } = await runCatchUp(cid, t);
          if (cancelled || convRef.current !== cid) return;
          if (complete && channelReadyRef.current) {
            stopPollingAfterRecovery();
            setRealtime("live");
          }
        } catch (e) {
          void handleApiFailure(e);
        }
      }, 3000);
    };

    void createVisitorEcho(t)
      .then((echo) => {
        if (cancelled || tokenRef.current !== t || convRef.current !== cid) {
          disconnectEcho(echo);
          return;
        }
        disconnectEcho(echoRef.current);
        echoRef.current = echo;
        if (!echo) {
          startPollingFallback();
          return;
        }
        subRef.current?.leave();
        channelReadyRef.current = false;
        subRef.current = subscribeToConversation(echo, cid, {
          onMessage: (msg) => applyIncoming(cid, [msg]),
          onSubscribed: () => {
            if (cancelled || !subRef.current?.active || convRef.current !== cid) return;
            channelReadyRef.current = true;
            void (async () => {
              try {
                const { complete } = await runCatchUp(cid, t);
                if (cancelled || !subRef.current?.active || convRef.current !== cid) return;
                if (complete) {
                  stopPollingAfterRecovery();
                  setRealtime("live");
                } else {
                  startPollingFallback();
                }
              } catch (e) {
                void handleApiFailure(e);
                if (!cancelled) startPollingFallback();
              }
            })();
          },
          onSubscriptionError: () => {
            if (cancelled || convRef.current !== cid) return;
            channelReadyRef.current = false;
            startPollingFallback();
          },
          onConnectionLost: () => {
            if (cancelled || convRef.current !== cid) return;
            channelReadyRef.current = false;
            startPollingFallback();
          },
          subscriptionTimeoutMs: 10_000,
        });
      })
      .catch(() => {
        if (!cancelled) startPollingFallback();
      });

    return () => {
      cancelled = true;
      channelReadyRef.current = false;
      pollStopRef.current?.();
      pollStopRef.current = null;
      subRef.current?.leave();
      subRef.current = null;
      disconnectEcho(echoRef.current);
      echoRef.current = null;
    };
  }, [token, conversationId, applyIncoming, handleApiFailure, runCatchUp]);

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
    if (!text.trim() || !token || sending) return;
    const t = token;
    const body = text.trim();
    setSending(true);
    setError(null);
    setDraft("");
    presenceRef.current?.noteActivity();
    try {
      const cid = await ensureConversation(t, pagePath);
      const pending = pendingRef.current.ensure(cid, body, "visitor", newClientMessageId);
      bumpPending();
      const msg = await postVisitorMessage(t, cid, pending.clientMessageId, body);
      pendingRef.current.confirm(cid, pending.clientMessageId);
      if (convRef.current === cid) {
        setMsgs((prev) => mergeMessages(prev, [msg]));
        bumpPending();
      }
    } catch (e) {
      if (isAbortError(e)) return;
      const cid = convRef.current;
      if (cid) {
        // Mark the most recent pending for this text if present.
        const list = pendingRef.current.listFor(cid);
        const last = list[list.length - 1];
        if (last) pendingRef.current.markFailed(cid, last.clientMessageId);
        bumpPending();
      }
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

  const diagPanel = showDiag ? (
    <PresenceDiagPanel
      events={diagEvents}
      presenceError={presenceError}
      registered={presenceRegistered}
      chatOpened={chatOpened}
      pagePath={pagePath}
    />
  ) : null;

  if (booting) {
    return (
      <>
        {diagPanel}
        <div className="p-6 text-sm text-muted-foreground">Starting chat…</div>
      </>
    );
  }

  if (!config) {
    return (
      <>
        {diagPanel}
        <div className="space-y-3 p-6 text-sm">
          <p className="text-muted-foreground">{error ?? "This chat isn't set up."}</p>
          <button type="button" className="underline" onClick={() => void bootstrap()}>Retry</button>
        </div>
      </>
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
      {diagPanel}
      <div className="space-y-1 border-b bg-muted/40 px-3 py-2 text-xs" role="status">
        <p className="text-muted-foreground">{realtimeStatusLabel(realtime)}</p>
        {storageNotice && <p className="text-muted-foreground">{storageNotice}</p>}
        {presenceError && !error && (
          <p className="text-amber-700 dark:text-amber-400">Presence: {presenceError}</p>
        )}
        {error && (
          <p className="text-destructive">
            {error}{" "}
            <button type="button" className="underline" onClick={() => void bootstrap()}>Retry</button>
            {" · "}
            <button type="button" className="underline" onClick={() => void renewSession("Starting fresh.")}>New session</button>
          </p>
        )}
      </div>
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
  messages: { key: string; from: string; text: string; time?: string | undefined }[];
  status?: string | undefined;
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

function Bubble({ from, text, time }: { from: string; text: string; time?: string | undefined }) {
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
