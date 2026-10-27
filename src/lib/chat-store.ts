// Browser-only shared chat store for the prototype. The widget (in an iframe on the
// same origin) and the Inbox sync through localStorage + BroadcastChannel.
import { useSyncExternalStore } from "react";

export type ChatMsg = { from: "visitor" | "agent" | "bot"; text: string; time: string };
export type LiveConv = {
  id: string; name: string; brand: string; brandId: string; page: string;
  status: "open" | "closed"; messages: ChatMsg[]; updated: number; unread: number;
};

const KEY = "bc_live_chats_v1";
const EMPTY: LiveConv[] = [];
let cache: LiveConv[] | null = null;
const listeners = new Set<() => void>();
let channel: BroadcastChannel | null = null;

function read(): LiveConv[] {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; }
}
function emit() { cache = read(); listeners.forEach((l) => l()); }
function init() {
  if (channel || typeof window === "undefined") return;
  channel = new BroadcastChannel("bc_live_chats");
  channel.onmessage = emit;
  window.addEventListener("storage", (e) => { if (e.key === KEY) emit(); });
}
function write(next: LiveConv[]) {
  localStorage.setItem(KEY, JSON.stringify(next));
  cache = next; listeners.forEach((l) => l()); channel?.postMessage("x");
}

export const now = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export function addMessage(convId: string, msg: ChatMsg, meta?: Omit<LiveConv, "id" | "messages" | "updated" | "unread" | "status">) {
  const list = read();
  let c = list.find((x) => x.id === convId);
  if (!c) {
    if (!meta) return;
    c = { id: convId, ...meta, status: "open", messages: [], updated: 0, unread: 0 };
    list.unshift(c);
  }
  c.messages.push(msg);
  c.updated = Date.now();
  c.unread = msg.from === "visitor" ? c.unread + 1 : 0;
  c.status = "open";
  write([c, ...list.filter((x) => x.id !== convId)]);
}
export function markRead(convId: string) {
  const list = read(); const c = list.find((x) => x.id === convId);
  if (c && c.unread) { c.unread = 0; write(list); }
}
export function closeConv(convId: string) {
  const list = read(); const c = list.find((x) => x.id === convId);
  if (c) { c.status = "closed"; write(list); }
}

export function useLiveChats(): LiveConv[] {
  return useSyncExternalStore(
    (l) => { init(); listeners.add(l); return () => listeners.delete(l); },
    () => (cache ??= read()),
    () => EMPTY,
  );
}
