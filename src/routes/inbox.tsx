import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Send, Paperclip, Smile, Bot, Radio } from "lucide-react";
import { Card, Badge, Btn } from "@/components/app-shell";
import { brands as sampleBrands, conversations, messages } from "@/lib/sample-data";
import { addMessage, closeConv, markRead, now, useLiveChats } from "@/lib/chat-store";
import { ApiError, isAbortError, isRealChatEnabled } from "@/lib/api";
import {
  fetchAgentMessages,
  fetchConversations,
  formatMsgTime,
  markConversationRead,
  newClientMessageId,
  patchConversationStatus,
  postAgentMessage,
  type ApiConversation,
  type ApiMessage,
} from "@/lib/chat-api";
import {
  createAgentEcho,
  disconnectEcho,
  realtimeStatusLabel,
  startBoundedMessagePolling,
  subscribeToConversation,
  type ConversationSubscription,
  type EchoLike,
  type RealtimeStatus,
} from "@/lib/echo-client";
import { drainCatchUpAfter, HttpSyncWatermark } from "@/lib/catch-up";
import { latestServerId, mergeMessages, PendingSendRegistry } from "@/lib/message-utils";

export const Route = createFileRoute("/inbox")({
  head: () => ({
    meta: [
      { title: "Inbox · BrandConnect" },
      { name: "description", content: "Reply to visitor conversations across every brand." },
      { property: "og:title", content: "Inbox · BrandConnect" },
      { property: "og:description", content: "Reply to visitor conversations across every brand." },
    ],
  }),
  component: InboxPage,
});

type Row = { id: string; name: string; brand: string; last: string; time: string; unread: number; status: string; sub: string; live: boolean };

function InboxPage() {
  return isRealChatEnabled() ? <RealInbox /> : <DemoInbox />;
}

function DemoInbox() {
  const live = useLiveChats();
  const [tab, setTab] = useState<"open" | "pending" | "closed">("open");
  const [active, setActive] = useState("c1");
  const [demoMsgs, setDemoMsgs] = useState(messages);
  const [draft, setDraft] = useState("");

  const rows: Row[] = [
    ...live.map((c) => ({
      id: c.id, name: c.name, brand: c.brand, last: c.messages.at(-1)?.text ?? "", time: c.messages.at(-1)?.time ?? "",
      unread: c.unread, status: c.status, sub: `Widget · ${c.page}`, live: true,
    })),
    ...conversations.map((c) => ({ ...c, sub: c.dept, live: false })),
  ];
  const shown = rows.filter((r) => r.status === tab);
  const conv = rows.find((r) => r.id === active) ?? rows[0]!;
  const liveConv = live.find((c) => c.id === conv.id);
  const msgs = liveConv ? liveConv.messages : demoMsgs;

  useEffect(() => { if (liveConv?.unread) markRead(liveConv.id); }, [liveConv?.id, liveConv?.unread]);

  const send = () => {
    if (!draft.trim()) return;
    if (liveConv) addMessage(liveConv.id, { from: "agent", text: draft.trim(), time: now() });
    else setDemoMsgs([...demoMsgs, { from: "agent", text: draft, time: "now" }]);
    setDraft("");
  };

  return (
    <InboxLayout
      tab={tab}
      setTab={setTab}
      shown={shown}
      conv={conv}
      setActive={setActive}
      msgs={msgs.map((m, i) => ({ key: String(i), from: m.from, text: m.text, time: m.time }))}
      draft={draft}
      setDraft={setDraft}
      onSend={send}
      onClose={() => liveConv && closeConv(liveConv.id)}
      visitorPreviewBrandId={sampleBrands[0]?.publicId ?? null}
      sideDetails={liveConv
        ? [["Source", "Chat widget"], ["Current page", liveConv.page], ["Brand", liveConv.brand], ["Messages", String(liveConv.messages.length)]]
        : [["Email", "maria@example.com"], ["Location", "Albany, US"], ["Current page", "/pricing"], ["Source", "google / cpc"], ["Visits", "3"], ["Lead stage", "Qualified"]]}
    />
  );
}

function RealInbox() {
  const [tab, setTab] = useState<"open" | "pending" | "closed">("open");
  const [active, setActive] = useState<string | null>(null);
  const [rows, setRows] = useState<ApiConversation[]>([]);
  const [msgs, setMsgs] = useState<ApiMessage[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [pendingTick, setPendingTick] = useState(0);
  const [realtime, setRealtime] = useState<RealtimeStatus>("connecting");

  const pendingRef = useRef(new PendingSendRegistry());
  const draftsRef = useRef(new Map<string, string>());
  const activeRef = useRef<string | null>(null);
  const msgsRef = useRef<ApiMessage[]>([]);
  const syncWatermarkRef = useRef(new HttpSyncWatermark());
  const listAbortRef = useRef<AbortController | null>(null);
  const msgsAbortRef = useRef<AbortController | null>(null);
  const echoRef = useRef<EchoLike | null>(null);
  const echoReadyRef = useRef(false);
  const subRef = useRef<ConversationSubscription | null>(null);
  const pollStopRef = useRef<(() => void) | null>(null);
  /** True only between channel.subscribed and connection-lost / leave. */
  const channelReadyRef = useRef(false);
  const convGenRef = useRef(0);

  activeRef.current = active;
  msgsRef.current = msgs;

  const bumpPending = () => setPendingTick((n) => n + 1);

  /** Patch inbox row previews from authorized message events (does not discover new conversations). */
  const applyConversationPreview = useCallback((incoming: ApiMessage[]) => {
    if (!incoming.length) return;
    setRows((prev) => {
      let changed = false;
      const next = prev.map((row) => {
        const latest = incoming.filter((m) => m.conversation_id === row.id).sort((a, b) => a.id - b.id).at(-1);
        if (!latest) return row;
        changed = true;
        const isActive = activeRef.current === row.id;
        return {
          ...row,
          last_message_preview: latest.body,
          last_message_at: latest.created_at,
          unread_count: isActive ? row.unread_count : (row.unread_count ?? 0) + 1,
          updated_at: latest.created_at,
        };
      });
      return changed ? next : prev;
    });
  }, []);

  const applyIncoming = useCallback((conversationId: string, incoming: ApiMessage[]) => {
    // Echo / display merge only — does not advance HTTP sync watermark.
    applyConversationPreview(incoming);
    if (activeRef.current !== conversationId) return;
    setMsgs((prev) => {
      const merged = mergeMessages(prev, incoming);
      for (const m of incoming) {
        if (m.client_message_id) pendingRef.current.confirm(conversationId, m.client_message_id);
      }
      return merged;
    });
    bumpPending();
  }, [applyConversationPreview]);

  const runCatchUp = useCallback(async (conversationId: string, signal?: AbortSignal): Promise<{ complete: boolean }> => {
    const gen = convGenRef.current;
    const afterId = syncWatermarkRef.current.current;
    if (afterId == null) {
      try {
        const page = await fetchAgentMessages(conversationId, {}, { signal });
        if (gen !== convGenRef.current || activeRef.current !== conversationId) return { complete: false };
        setMsgs((prev) => mergeMessages(prev, page.data));
        setOlderCursor((c) => c ?? page.nextCursor);
        syncWatermarkRef.current.reset(latestServerId(page.data));
        for (const m of page.data) {
          if (m.client_message_id) pendingRef.current.confirm(conversationId, m.client_message_id);
        }
        bumpPending();
        return { complete: true };
      } catch (e) {
        if (isAbortError(e) || gen !== convGenRef.current) return { complete: false };
        return { complete: false };
      }
    }

    const result = await drainCatchUpAfter(
      afterId,
      (params) => fetchAgentMessages(conversationId, params, { signal }),
      {
        signal,
        onPage: (pageMessages) => {
          if (gen !== convGenRef.current || activeRef.current !== conversationId) return;
          applyIncoming(conversationId, pageMessages);
        },
      },
    );

    if (gen !== convGenRef.current || activeRef.current !== conversationId) return { complete: false };

    // Advance watermark from HTTP only — Echo arrivals already in display do not move it.
    syncWatermarkRef.current.advanceFromHttp(result.confirmedThroughId);
    if (result.messages.length) applyIncoming(conversationId, result.messages);

    if (result.complete) {
      const readId = syncWatermarkRef.current.current;
      if (readId) {
        try { await markConversationRead(conversationId, readId, { signal }); } catch { /* ignore */ }
      }
    }
    // Incomplete: retain safe recovery position; do not mark read beyond the unfilled gap.
    return { complete: result.complete };
  }, [applyIncoming]);

  const loadList = useCallback(async () => {
    listAbortRef.current?.abort();
    const ac = new AbortController();
    listAbortRef.current = ac;
    try {
      const list = await fetchConversations({ status: tab }, { signal: ac.signal });
      setRows(list);
      setActive((prev) => (prev && list.some((c) => c.id === prev) ? prev : list[0]?.id ?? null));
    } catch (e) {
      if (isAbortError(e)) return;
      setError(e instanceof ApiError ? e.message : "Failed to load conversations");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    setLoading(true);
    void loadList();
    // Keep inbox-list polling until new-conversation notifications exist.
    const t = window.setInterval(() => void loadList(), 5000);
    return () => {
      window.clearInterval(t);
      listAbortRef.current?.abort();
    };
  }, [loadList]);

  useEffect(() => {
    let cancelled = false;
    setRealtime("connecting");
    void createAgentEcho()
      .then((echo) => {
        if (cancelled) {
          disconnectEcho(echo);
          return;
        }
        echoRef.current = echo;
        echoReadyRef.current = true;
        setRealtime(echo ? "connecting" : "polling");
      })
      .catch(() => {
        if (cancelled) return;
        echoRef.current = null;
        echoReadyRef.current = true;
        setRealtime("polling");
      });
    return () => {
      cancelled = true;
      pollStopRef.current?.();
      pollStopRef.current = null;
      subRef.current?.leave();
      subRef.current = null;
      disconnectEcho(echoRef.current);
      echoRef.current = null;
      // Logout/unmount identity reset
      pendingRef.current.clearAll();
    };
  }, []);

  useEffect(() => {
    msgsAbortRef.current?.abort();
    subRef.current?.leave();
    subRef.current = null;
    pollStopRef.current?.();
    pollStopRef.current = null;

    // Preserve pending sends across switches; only swap transcript + draft.
    setMsgs([]);
    setOlderCursor(null);
    syncWatermarkRef.current.reset(undefined);
    if (active) {
      setDraft(draftsRef.current.get(active) ?? "");
    } else {
      setDraft("");
    }
    bumpPending();

    if (!active) return;

    convGenRef.current += 1;
    const gen = convGenRef.current;
    const conversationId = active;
    const ac = new AbortController();
    msgsAbortRef.current = ac;
    let cancelled = false;

    void (async () => {
      try {
        const page = await fetchAgentMessages(conversationId, {}, { signal: ac.signal });
        if (gen !== convGenRef.current || activeRef.current !== conversationId) return;
        setMsgs(page.data);
        setOlderCursor(page.nextCursor);
        syncWatermarkRef.current.reset(latestServerId(page.data));
        for (const m of page.data) {
          if (m.client_message_id) pendingRef.current.confirm(conversationId, m.client_message_id);
        }
        bumpPending();
        const readId = syncWatermarkRef.current.current;
        if (readId) {
          try { await markConversationRead(conversationId, readId, { signal: ac.signal }); } catch { /* ignore */ }
        }
      } catch (e) {
        if (isAbortError(e) || gen !== convGenRef.current) return;
        setError(e instanceof ApiError ? e.message : "Failed to load messages");
      }
    })();

    channelReadyRef.current = false;

    const stopPollingAfterRecovery = () => {
      pollStopRef.current?.();
      pollStopRef.current = null;
    };

    const startPollingFallback = () => {
      if (cancelled || activeRef.current !== conversationId) return;
      setRealtime("polling");
      if (pollStopRef.current) return;
      pollStopRef.current = startBoundedMessagePolling(async () => {
        if (cancelled || activeRef.current !== conversationId) return;
        const { complete } = await runCatchUp(conversationId);
        if (cancelled || activeRef.current !== conversationId) return;
        // Stop only when channel is subscribed again and catch-up finished.
        if (complete && channelReadyRef.current) {
          stopPollingAfterRecovery();
          setRealtime("live");
        }
      }, 3000);
    };

    const attachSubscription = (echo: EchoLike) => {
      subRef.current?.leave();
      channelReadyRef.current = false;
      subRef.current = subscribeToConversation(echo, conversationId, {
        onMessage: (msg) => applyIncoming(conversationId, [msg]),
        onSubscribed: () => {
          if (cancelled || activeRef.current !== conversationId || !subRef.current?.active) return;
          channelReadyRef.current = true;
          void (async () => {
            const { complete } = await runCatchUp(conversationId, ac.signal);
            if (cancelled || activeRef.current !== conversationId || !subRef.current?.active) return;
            // Stop fallback only after subscription succeeds AND catch-up completes.
            if (complete) {
              stopPollingAfterRecovery();
              setRealtime("live");
            } else {
              startPollingFallback();
            }
          })();
        },
        onSubscriptionError: () => {
          if (cancelled || activeRef.current !== conversationId) return;
          channelReadyRef.current = false;
          startPollingFallback();
        },
        onConnectionLost: () => {
          if (cancelled || activeRef.current !== conversationId) return;
          channelReadyRef.current = false;
          startPollingFallback();
        },
        subscriptionTimeoutMs: 10_000,
      });
    };

    const waitForEcho = window.setInterval(() => {
      if (!echoReadyRef.current) return;
      window.clearInterval(waitForEcho);
      if (cancelled || activeRef.current !== conversationId) return;
      const echo = echoRef.current;
      if (!echo) {
        startPollingFallback();
        return;
      }
      attachSubscription(echo);
    }, 50);

    return () => {
      cancelled = true;
      channelReadyRef.current = false;
      window.clearInterval(waitForEcho);
      ac.abort();
      pollStopRef.current?.();
      pollStopRef.current = null;
      subRef.current?.leave();
      subRef.current = null;
    };
  }, [active, applyIncoming, runCatchUp]);

  const loadOlder = async () => {
    if (!active || !olderCursor || loadingOlder) return;
    setLoadingOlder(true);
    const conversationId = active;
    const gen = convGenRef.current;
    try {
      const page = await fetchAgentMessages(conversationId, { cursor: olderCursor });
      if (gen !== convGenRef.current || activeRef.current !== conversationId) return;
      setMsgs((prev) => mergeMessages(page.data, prev));
      setOlderCursor(page.nextCursor);
    } catch (e) {
      if (!isAbortError(e) && activeRef.current === conversationId) {
        setError(e instanceof ApiError ? e.message : "Could not load older messages");
      }
    } finally {
      setLoadingOlder(false);
    }
  };

  const mapped: Row[] = rows.map((c) => ({
    id: c.id,
    name: c.visitor_name || "Visitor",
    brand: c.brand?.name ?? `Brand #${c.brand_id}`,
    last: c.last_message_preview ?? "",
    time: c.last_message_at ? formatMsgTime(c.last_message_at) : "",
    unread: c.unread_count ?? 0,
    status: c.status,
    sub: `Widget · ${c.page ?? "/"}`,
    live: true,
  }));
  const shown = mapped;
  const conv = shown.find((r) => r.id === active) ?? shown[0] ?? {
    id: "", name: "No conversation", brand: "—", last: "", time: "", unread: 0, status: tab, sub: "", live: false,
  };
  const apiConv = rows.find((c) => c.id === conv.id);
  void pendingTick;
  const pendingForActive = conv.id ? pendingRef.current.listFor(conv.id) : [];

  const setDraftForActive = (value: string) => {
    if (active) draftsRef.current.set(active, value);
    setDraft(value);
  };

  const send = async () => {
    if (!draft.trim() || !conv.id || sending) return;
    const conversationId = conv.id;
    const text = draft.trim();
    const pending = pendingRef.current.ensure(conversationId, text, "agent", newClientMessageId);
    bumpPending();
    setSending(true);
    if (activeRef.current === conversationId) {
      setError(null);
      setDraftForActive("");
    } else {
      draftsRef.current.set(conversationId, "");
    }
    try {
      const msg = await postAgentMessage(conversationId, pending.clientMessageId, text);
      pendingRef.current.confirm(conversationId, pending.clientMessageId);
      applyConversationPreview([msg]);
      if (activeRef.current === conversationId) {
        setMsgs((prev) => mergeMessages(prev, [msg]));
        bumpPending();
      }
    } catch (e) {
      if (isAbortError(e)) return;
      pendingRef.current.markFailed(conversationId, pending.clientMessageId);
      bumpPending();
      // Late failure must not clobber another conversation's draft/error.
      if (activeRef.current === conversationId) {
        setDraftForActive(text);
        setError(e instanceof ApiError ? e.message : "Send failed");
      } else {
        draftsRef.current.set(conversationId, text);
      }
    } finally {
      if (activeRef.current === conversationId) setSending(false);
      else setSending(false);
    }
  };

  const retryFailed = (clientMessageId: string) => {
    if (!conv.id) return;
    const pending = pendingRef.current.get(conv.id, clientMessageId);
    if (!pending) return;
    setDraftForActive(pending.text);
    pending.status = "pending";
    bumpPending();
  };

  const onClose = async () => {
    if (!conv.id) return;
    try {
      await patchConversationStatus(conv.id, "closed");
      await loadList();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not close chat");
    }
  };

  const displayMsgs = [
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
      failed: p.status === "failed",
      onRetry: p.status === "failed" ? () => retryFailed(p.clientMessageId) : undefined,
    })),
  ];

  return (
    <>
      <p className="mb-2 text-xs text-muted-foreground" role="status">{realtimeStatusLabel(realtime)}</p>
      {error && (
        <div className="mb-3 flex items-center gap-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
          <span className="flex-1">{error}</span>
          <Btn variant="outline" type="button" onClick={() => void loadList()}>Retry</Btn>
        </div>
      )}
      {loading && shown.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">Loading conversations…</Card>
      ) : (
        <InboxLayout
          tab={tab}
          setTab={setTab}
          shown={shown}
          conv={conv}
          setActive={setActive}
          msgs={displayMsgs}
          draft={draft}
          setDraft={setDraftForActive}
          onSend={() => void send()}
          onClose={() => void onClose()}
          onLoadOlder={olderCursor ? () => void loadOlder() : undefined}
          loadingOlder={loadingOlder}
          visitorPreviewBrandId={
            apiConv?.brand?.public_id
            ?? rows.find((c) => c.brand?.public_id)?.brand?.public_id
            ?? null
          }
          sideDetails={apiConv
            ? [["Source", "Chat widget"], ["Current page", apiConv.page ?? "/"], ["Brand", apiConv.brand?.name ?? String(apiConv.brand_id)], ["Messages", String(msgs.length)]]
            : [["Source", "—"]]}
        />
      )}
    </>
  );
}

function InboxLayout({
  tab, setTab, shown, conv, setActive, msgs, draft, setDraft, onSend, onClose, sideDetails, onLoadOlder, loadingOlder, visitorPreviewBrandId,
}: {
  tab: "open" | "pending" | "closed";
  setTab: (t: "open" | "pending" | "closed") => void;
  shown: Row[];
  conv: Row;
  setActive: (id: string) => void;
  msgs: { key: string; from: string; text: string; time: string; failed?: boolean | undefined; onRetry?: (() => void) | undefined }[];
  draft: string;
  setDraft: (v: string) => void;
  onSend: () => void;
  onClose: () => void;
  sideDetails: string[][];
  onLoadOlder?: (() => void) | undefined;
  loadingOlder?: boolean | undefined;
  /** Real mode: API brand public_id. Demo mode: sample publicId. Null → link to Brands. */
  visitorPreviewBrandId?: string | null | undefined;
}) {
  return (
    <div className="grid h-[calc(100vh-7.5rem)] gap-4 md:grid-cols-[300px_1fr] xl:grid-cols-[300px_1fr_260px]">
      <Card className="flex flex-col overflow-hidden">
        <div className="flex gap-1 border-b p-2 text-sm">
          {(["open", "pending", "closed"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`rounded-md px-3 py-1.5 capitalize ${tab === t ? "bg-accent text-accent-foreground font-medium" : "hover:bg-muted"}`}>{t}</button>
          ))}
        </div>
        <ul className="flex-1 overflow-y-auto">
          {shown.length === 0 && <li className="p-4 text-sm text-muted-foreground">No conversations here.</li>}
          {shown.map((c) => (
            <li key={c.id}>
              <button onClick={() => setActive(c.id)} className={`w-full border-b p-3 text-left hover:bg-muted/60 ${conv.id === c.id ? "bg-muted" : ""}`}>
                <div className="flex items-center gap-2">
                  {c.live && <Radio className="size-3.5 text-success" aria-label="Live from widget" />}
                  <span className="text-sm font-medium">{c.name}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{c.time}</span>
                </div>
                <p className="mt-0.5 truncate text-sm text-muted-foreground">{c.last}</p>
                <div className="mt-1.5 flex items-center gap-2">
                  <Badge>{c.brand}</Badge>
                  {c.unread > 0 && <span className="ml-auto rounded-full bg-primary px-1.5 text-xs text-primary-foreground">{c.unread}</span>}
                </div>
              </button>
            </li>
          ))}
        </ul>
        {visitorPreviewBrandId ? (
          <Link
            to="/widget-demo"
            search={{ brand: visitorPreviewBrandId }}
            reloadDocument
            className="border-t p-3 text-center text-xs text-primary underline"
          >
            Open demo site to chat as a visitor
          </Link>
        ) : (
          <Link to="/brands" className="border-t p-3 text-center text-xs text-primary underline">
            Create a brand to preview the visitor widget →
          </Link>
        )}
      </Card>
      <Card className="flex flex-col overflow-hidden">
        <div className="flex items-center gap-3 border-b p-3">
          <div>
            <p className="font-medium">{conv.name}</p>
            <p className="text-xs text-muted-foreground">{conv.brand} · {conv.sub}</p>
          </div>
          <Btn variant="outline" className="ml-auto" onClick={onClose}>Close chat</Btn>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto bg-muted/30 p-4" aria-live="polite">
          {onLoadOlder && (
            <div className="text-center">
              <button type="button" className="text-xs text-primary underline" onClick={onLoadOlder} disabled={loadingOlder}>
                {loadingOlder ? "Loading…" : "Load older messages"}
              </button>
            </div>
          )}
          {msgs.map((m) => (
            <div key={m.key} className={`flex ${m.from === "agent" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm ${m.from === "agent" ? "bg-primary text-primary-foreground" : "bg-card border"} ${m.failed ? "opacity-80 ring-1 ring-destructive" : ""}`}>
                {m.from === "bot" && <p className="mb-1 flex items-center gap-1 text-xs text-muted-foreground"><Bot className="size-3" /> Automated greeting</p>}
                {m.text}
                <p className={`mt-1 text-[10px] ${m.from === "agent" ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                  {m.time}
                  {m.failed && m.onRetry && (
                    <>
                      {" · "}
                      <button type="button" className="underline" onClick={m.onRetry}>Retry</button>
                    </>
                  )}
                </p>
              </div>
            </div>
          ))}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); onSend(); }} className="flex items-center gap-2 border-t p-3">
          <button type="button" aria-label="Attach" className="rounded p-2 hover:bg-muted"><Paperclip className="size-4" /></button>
          <button type="button" aria-label="Emoji" className="rounded p-2 hover:bg-muted"><Smile className="size-4" /></button>
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Type a reply, or / for canned replies" className="h-9 flex-1 rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          <Btn type="submit"><Send className="size-4" />Send</Btn>
        </form>
      </Card>
      <Card className="hidden space-y-4 p-4 text-sm xl:block">
        <h2 className="font-medium">Visitor details</h2>
        {sideDetails.map(([k, v]) => (
          <div key={k}><p className="text-xs text-muted-foreground">{k}</p><p>{v}</p></div>
        ))}
      </Card>
    </div>
  );
}
