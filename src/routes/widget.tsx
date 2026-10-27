import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Send, X } from "lucide-react";
import { brands } from "@/lib/sample-data";
import { addMessage, now, useLiveChats } from "@/lib/chat-store";

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

function Widget() {
  const { brand: publicId, page } = Route.useSearch();
  const brand = brands.find((b) => b.publicId === publicId);
  const [convId, setConvId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const chats = useLiveChats();
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const k = `bc_conv_${publicId}`;
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
    <div className="flex h-screen flex-col bg-card text-card-foreground">
      <div className="flex items-center gap-3 p-4 text-primary-foreground" style={{ background: brand.color }}>
        <div className="flex size-9 items-center justify-center rounded-full bg-background/25 font-semibold">{brand.name[0]}</div>
        <div><p className="font-semibold">{brand.name}</p><p className="text-xs opacity-90">We usually reply in a few minutes</p></div>
        <button aria-label="Close chat" className="ml-auto rounded p-1 hover:bg-background/20" onClick={() => window.parent.postMessage("bc:close", "*")}><X className="size-5" /></button>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto bg-muted/30 p-4" aria-live="polite">
        <Bubble from="bot" text={`Hi there! 👋 Welcome to ${brand.name}. How can we help today?`} />
        {msgs.length === 0 && (
          <div className="flex flex-wrap gap-2">
            {quick.map((q) => <button key={q} onClick={() => send(q)} className="rounded-full border bg-card px-3 py-1.5 text-sm hover:bg-muted">{q}</button>)}
          </div>
        )}
        {msgs.map((m, i) => <Bubble key={i} from={m.from} text={m.text} time={m.time} />)}
        {conv?.status === "closed" && <p className="text-center text-xs text-muted-foreground">This chat was closed. Send a message to start again.</p>}
        <div ref={end} />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); send(draft); }} className="flex gap-2 border-t p-3">
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Type your message…" aria-label="Message" className="h-10 flex-1 rounded-full border bg-background px-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        <button type="submit" aria-label="Send" className="flex size-10 items-center justify-center rounded-full text-primary-foreground" style={{ background: brand.color }}><Send className="size-4" /></button>
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
