import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Send, Paperclip, Smile, Bot, Radio } from "lucide-react";
import { Card, Badge, Btn } from "@/components/app-shell";
import { conversations, messages } from "@/lib/sample-data";
import { addMessage, closeConv, markRead, now, useLiveChats } from "@/lib/chat-store";

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
          <Btn variant="outline" className="ml-auto" onClick={() => liveConv && closeConv(liveConv.id)}>Close chat</Btn>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto bg-muted/30 p-4" aria-live="polite">
          {msgs.map((m, i) => (
            <div key={i} className={`flex ${m.from === "agent" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm ${m.from === "agent" ? "bg-primary text-primary-foreground" : "bg-card border"}`}>
                {m.from === "bot" && <p className="mb-1 flex items-center gap-1 text-xs text-muted-foreground"><Bot className="size-3" /> Automated greeting</p>}
                {m.text}
                <p className={`mt-1 text-[10px] ${m.from === "agent" ? "text-primary-foreground/70" : "text-muted-foreground"}`}>{m.time}</p>
              </div>
            </div>
          ))}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex items-center gap-2 border-t p-3">
          <button type="button" aria-label="Attach" className="rounded p-2 hover:bg-muted"><Paperclip className="size-4" /></button>
          <button type="button" aria-label="Emoji" className="rounded p-2 hover:bg-muted"><Smile className="size-4" /></button>
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Type a reply, or / for canned replies" className="h-9 flex-1 rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          <Btn type="submit"><Send className="size-4" />Send</Btn>
        </form>
      </Card>
      <Card className="hidden space-y-4 p-4 text-sm xl:block">
        <h2 className="font-medium">Visitor details</h2>
        {(liveConv
          ? [["Source", "Chat widget"], ["Current page", liveConv.page], ["Brand", liveConv.brand], ["Messages", String(liveConv.messages.length)]]
          : [["Email", "maria@example.com"], ["Location", "Albany, US"], ["Current page", "/pricing"], ["Source", "google / cpc"], ["Visits", "3"], ["Lead stage", "Qualified"]]
        ).map(([k, v]) => (
          <div key={k}><p className="text-xs text-muted-foreground">{k}</p><p>{v}</p></div>
        ))}
      </Card>
    </div>
  );
}
