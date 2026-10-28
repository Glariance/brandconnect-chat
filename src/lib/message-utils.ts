import type { ApiMessage } from "@/lib/chat-api";

export type PendingMessage = {
  conversationId: string;
  clientMessageId: string;
  text: string;
  senderType: "visitor" | "agent";
  createdAt: string;
  status: "pending" | "failed";
};

export type DisplayMessage = {
  key: string;
  id?: number;
  clientMessageId?: string;
  conversationId?: string;
  from: string;
  text: string;
  time: string;
  pending?: boolean;
  failed?: boolean;
};

/** Merge by server id / client_message_id, then sort ascending by server id (pending last among ties). */
export function mergeMessages(existing: ApiMessage[], incoming: ApiMessage[]): ApiMessage[] {
  const byId = new Map<number, ApiMessage>();
  const byClient = new Map<string, ApiMessage>();

  for (const msg of [...existing, ...incoming]) {
    if (msg.id != null) byId.set(msg.id, msg);
    if (msg.client_message_id) byClient.set(msg.client_message_id, msg);
  }

  // Prefer server rows keyed by id; also keep any client-only entries already folded into byId via id
  const merged = new Map<number, ApiMessage>();
  for (const msg of byId.values()) {
    merged.set(msg.id, msg);
  }

  // If an incoming message shares a client id with an existing id-keyed message, keep the server one
  for (const msg of byClient.values()) {
    if (!merged.has(msg.id)) {
      merged.set(msg.id, msg);
    }
  }

  return [...merged.values()].sort((a, b) => a.id - b.id);
}

export function latestServerId(messages: ApiMessage[]): number | undefined {
  let max: number | undefined;
  for (const m of messages) {
    if (max == null || m.id > max) max = m.id;
  }
  return max;
}

export function pendingKey(conversationId: string, clientMessageId: string): string {
  return `${conversationId}:${clientMessageId}`;
}

/**
 * Track one stable client_message_id per in-flight text per conversation.
 * Cleared only after the server confirms that client id (or the user discards a failed send).
 */
export class PendingSendRegistry {
  private pending = new Map<string, PendingMessage>();

  listFor(conversationId: string): PendingMessage[] {
    return [...this.pending.values()].filter((p) => p.conversationId === conversationId);
  }

  get(conversationId: string, clientMessageId: string): PendingMessage | undefined {
    return this.pending.get(pendingKey(conversationId, clientMessageId));
  }

  /** Reuse an existing pending id for the same conversation+text while still pending/failed. */
  ensure(
    conversationId: string,
    text: string,
    senderType: "visitor" | "agent",
    createId: () => string,
  ): PendingMessage {
    for (const p of this.listFor(conversationId)) {
      if (p.text === text && (p.status === "pending" || p.status === "failed")) {
        p.status = "pending";
        this.pending.set(pendingKey(conversationId, p.clientMessageId), p);
        return p;
      }
    }
    const row: PendingMessage = {
      conversationId,
      clientMessageId: createId(),
      text,
      senderType,
      createdAt: new Date().toISOString(),
      status: "pending",
    };
    this.pending.set(pendingKey(conversationId, row.clientMessageId), row);
    return row;
  }

  markFailed(conversationId: string, clientMessageId: string): void {
    const row = this.get(conversationId, clientMessageId);
    if (row) {
      row.status = "failed";
      this.pending.set(pendingKey(conversationId, clientMessageId), row);
    }
  }

  /** Drop pending once the server has confirmed that client_message_id. */
  confirm(conversationId: string, clientMessageId: string): void {
    this.pending.delete(pendingKey(conversationId, clientMessageId));
  }

  clearConversation(conversationId: string): void {
    for (const key of [...this.pending.keys()]) {
      if (key.startsWith(`${conversationId}:`)) this.pending.delete(key);
    }
  }

  clearAll(): void {
    this.pending.clear();
  }
}

export function isVisitorAuthExpired(status: number): boolean {
  return status === 401 || status === 403;
}
