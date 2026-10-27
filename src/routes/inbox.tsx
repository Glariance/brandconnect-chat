import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Send, Paperclip, Smile, Bot, Radio } from "lucide-react";
import { Card, Badge, Btn } from "@/components/app-shell";
import { conversations, messages } from "@/lib/sample-data";
import { addMessage, closeConv, markRead, now, useLiveChats } from "@/lib/chat-store";
import { ApiError, isRealChatEnabled } from "@/lib/api";
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
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const loadList = useCallback(async () => {
    try {
      setError(null);
      const list = await fetchConversations({ status: tab });
      setRows(list);
      setActive((prev) => {
        if (prev && list.some((c) => c.id === prev)) return prev;
        return list[0]?.id ?? null;
      });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load conversations");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    setLoading(true);
    void loadList();
    const t = window.setInterval(() => void loadList(), 5000);
    return () => window.clearInterval(t);
  }, [loadList]);

  const loadMessages = useCallback(async (id: string) => {
    try {
      const list = await fetchAgentMessages(id);
      setMsgs(list);
      const last = list.at(-1);
      if (last) {
        try { await markConversationRead(id, last.id); } catch { /* ignore */ }
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load messages");
    }
  }, []);

  useEffect(() => {
    if (!active) { setMsgs([]); return; }
    void loadMessages(active);
    const t = window.setInterval(() => void loadMessages(active), 3000);
    return () => window.clearInterval(t);
  }, [active, loadMessages]);

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

  const send = async () => {
    if (!draft.trim() || !conv.id || sending) return;
    setSending(true);
    setError(null);
    const text = draft.trim();
    const clientId = newClientMessageId();
    try {
      const msg = await postAgentMessage(conv.id, clientId, text);
      setMsgs((prev) => (prev.some((m) => m.id === msg.id || m.client_message_id === clientId) ? prev : [...prev, msg]));
      setDraft("");
      await loadList();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Send failed");
    } finally {
      setSending(false);
    }
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

  return (
    <>
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
          msgs={msgs.map((m) => ({
            key: String(m.id),
            from: m.sender_type,
            text: m.body,
            time: formatMsgTime(m.created_at),
          }))}
          draft={draft}
          setDraft={setDraft}
          onSend={() => void send()}
          onClose={() => void onClose()}
          sideDetails={apiConv
            ? [["Source", "Chat widget"], ["Current page", apiConv.page ?? "/"], ["Brand", apiConv.brand?.name ?? String(apiConv.brand_id)], ["Messages", String(msgs.length)]]
            : [["Source", "—"]]}
        />
      )}
    </>
  );
}

function InboxLayout({
  tab, setTab, shown, conv, setActive, msgs, draft, setDraft, onSend, onClose, sideDetails,
}: {
  tab: "open" | "pending" | "closed";
  setTab: (t: "open" | "pending" | "closed") => void;
  shown: Row[];
  conv: Row;
  setActive: (id: string) => void;
  msgs: { key: string; from: string; text: string; time: string }[];
  draft: string;
  setDraft: (v: string) => void;
  onSend: () => void;
  onClose: () => void;
  sideDetails: string[][];
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
        <Link to="/widget-demo" search={{ brand: "nw_7f3a91" }} reloadDocument className="border-t p-3 text-center text-xs text-primary underline">Open demo site to chat as a visitor</Link>
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
          {msgs.map((m) => (
            <div key={m.key} className={`flex ${m.from === "agent" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm ${m.from === "agent" ? "bg-primary text-primary-foreground" : "bg-card border"}`}>
                {m.from === "bot" && <p className="mb-1 flex items-center gap-1 text-xs text-muted-foreground"><Bot className="size-3" /> Automated greeting</p>}
                {m.text}
                <p className={`mt-1 text-[10px] ${m.from === "agent" ? "text-primary-foreground/70" : "text-muted-foreground"}`}>{m.time}</p>
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
