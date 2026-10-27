/** Real persistent chat API helpers (replaces chat-store as source of truth in real mode). */
import { api } from "@/lib/api";

export type ApiBrand = {
  id: number;
  name: string;
  domain: string | null;
  timezone: string | null;
  color: string;
  public_id: string;
};

export type ApiConversation = {
  id: string;
  brand_id: number;
  brand?: ApiBrand;
  visitor_name: string;
  page: string | null;
  status: "open" | "closed" | "pending";
  unread_count: number;
  last_message_preview: string | null;
  last_message_at: string | null;
  updated_at: string;
};

export type ApiMessage = {
  id: number;
  conversation_id: string;
  client_message_id: string;
  sender_type: "visitor" | "agent" | "bot";
  body: string;
  created_at: string;
};

export type WidgetConfig = {
  public_id: string;
  name: string;
  color: string;
  greeting: string | null;
  allowed_origins: string[];
};

export type VisitorSession = {
  token: string;
  visitor_id: number;
  expires_at: string;
};

function unwrapList<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === "object" && "data" in payload) {
    const data = (payload as { data: unknown }).data;
    if (Array.isArray(data)) return data as T[];
  }
  return [];
}

function unwrapOne<T>(payload: unknown): T {
  if (payload && typeof payload === "object" && "data" in payload) {
    return (payload as { data: T }).data;
  }
  return payload as T;
}

export async function fetchBrands(): Promise<ApiBrand[]> {
  return unwrapList(await api("/brands"));
}

export async function createBrand(input: {
  name: string;
  domain?: string;
  timezone?: string;
  color?: string;
}): Promise<ApiBrand> {
  return unwrapOne(await api("/brands", { method: "POST", body: input }));
}

export async function fetchConversations(params: {
  brand_id?: number | string;
  status?: string;
  cursor?: string;
}): Promise<ApiConversation[]> {
  const q = new URLSearchParams();
  if (params.brand_id) q.set("brand_id", String(params.brand_id));
  if (params.status) q.set("status", params.status);
  if (params.cursor) q.set("cursor", params.cursor);
  const qs = q.toString();
  return unwrapList(await api(`/conversations${qs ? `?${qs}` : ""}`));
}

export async function fetchAgentMessages(
  conversationId: string,
  params?: { after_id?: number; cursor?: string },
): Promise<ApiMessage[]> {
  const q = new URLSearchParams();
  if (params?.after_id) q.set("after_id", String(params.after_id));
  if (params?.cursor) q.set("cursor", params.cursor);
  const qs = q.toString();
  return unwrapList(await api(`/conversations/${conversationId}/messages${qs ? `?${qs}` : ""}`));
}

export async function postAgentMessage(
  conversationId: string,
  clientMessageId: string,
  text: string,
): Promise<ApiMessage> {
  return unwrapOne(
    await api(`/conversations/${conversationId}/messages`, {
      method: "POST",
      body: { client_message_id: clientMessageId, text },
    }),
  );
}

export async function patchConversationStatus(
  conversationId: string,
  status: "open" | "closed" | "pending",
): Promise<ApiConversation> {
  return unwrapOne(
    await api(`/conversations/${conversationId}`, {
      method: "PATCH",
      body: { status },
    }),
  );
}

export async function markConversationRead(
  conversationId: string,
  messageId: number,
): Promise<void> {
  await api(`/conversations/${conversationId}/read`, {
    method: "POST",
    body: { message_id: messageId },
  });
}

export async function fetchWidgetConfig(publicId: string): Promise<WidgetConfig> {
  return unwrapOne(await api(`/widget/brands/${encodeURIComponent(publicId)}/config`, { public: true }));
}

export async function createVisitorSession(publicId: string): Promise<VisitorSession> {
  return unwrapOne(
    await api(`/widget/brands/${encodeURIComponent(publicId)}/sessions`, {
      method: "POST",
      public: true,
      body: {},
    }),
  );
}

export async function createVisitorConversation(
  token: string,
  input: { page?: string },
): Promise<ApiConversation> {
  return unwrapOne(
    await api("/widget/conversations", {
      method: "POST",
      bearer: token,
      body: input,
    }),
  );
}

export async function fetchVisitorMessages(
  token: string,
  conversationId: string,
  params?: { after_id?: number },
): Promise<ApiMessage[]> {
  const q = new URLSearchParams();
  if (params?.after_id) q.set("after_id", String(params.after_id));
  const qs = q.toString();
  return unwrapList(
    await api(`/widget/conversations/${conversationId}/messages${qs ? `?${qs}` : ""}`, {
      bearer: token,
    }),
  );
}

export async function postVisitorMessage(
  token: string,
  conversationId: string,
  clientMessageId: string,
  text: string,
): Promise<ApiMessage> {
  return unwrapOne(
    await api(`/widget/conversations/${conversationId}/messages`, {
      method: "POST",
      bearer: token,
      body: { client_message_id: clientMessageId, text },
    }),
  );
}

export async function markVisitorRead(
  token: string,
  conversationId: string,
  messageId: number,
): Promise<void> {
  await api(`/widget/conversations/${conversationId}/read`, {
    method: "POST",
    bearer: token,
    body: { message_id: messageId },
  });
}

export async function revokeVisitorSession(token: string): Promise<void> {
  await api("/widget/sessions/logout", { method: "POST", bearer: token });
}

export function newClientMessageId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function formatMsgTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}
