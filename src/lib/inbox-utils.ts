import type { ApiBrand, ApiConversation } from "@/lib/chat-api";

export type InboxSummary = {
  id: string;
  brand_id: number;
  status: "open" | "closed" | "pending";
  visitor_name: string;
  page: string | null;
  last_message_preview: string | null;
  last_message_at: string | null;
  updated_at: string | null;
  version: string;
};

export type InboxListFilters = {
  status: "open" | "pending" | "closed";
  /** Numeric brand id, or "all". */
  brandId: number | "all";
};

export function inboxSummaryFromBroadcast(payload: unknown): InboxSummary | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as { conversation?: unknown };
  const c = root.conversation;
  if (!c || typeof c !== "object") return null;
  const row = c as Record<string, unknown>;
  const id = row["id"];
  const brandId = row["brand_id"];
  if (typeof id !== "string" || typeof brandId !== "number") return null;
  const status = row["status"];
  if (status !== "open" && status !== "closed" && status !== "pending") return null;
  const versionRaw = row["version"];
  const updatedRaw = row["updated_at"];
  const lastAtRaw = row["last_message_at"];
  const version =
    typeof versionRaw === "string"
      ? versionRaw
      : typeof updatedRaw === "string"
        ? updatedRaw
        : typeof lastAtRaw === "string"
          ? lastAtRaw
          : null;
  if (!version) return null;

  const visitorName = row["visitor_name"];
  const page = row["page"];
  const preview = row["last_message_preview"];
  const lastAt = row["last_message_at"];
  const updatedAt = row["updated_at"];

  return {
    id,
    brand_id: brandId,
    status,
    visitor_name: typeof visitorName === "string" ? visitorName : "Visitor",
    page: typeof page === "string" ? page : null,
    last_message_preview: typeof preview === "string" ? preview : null,
    last_message_at: typeof lastAt === "string" ? lastAt : null,
    updated_at: typeof updatedAt === "string" ? updatedAt : null,
    version,
  };
}

export function conversationVersion(row: Pick<ApiConversation, "updated_at" | "last_message_at"> & { version?: string }): string {
  if (typeof row.version === "string" && row.version) return row.version;
  return row.updated_at || row.last_message_at || "";
}

/** ISO-8601 Zulu strings compare lexicographically; empty is oldest. */
export function isStaleInboxVersion(incoming: string, current: string): boolean {
  if (!incoming) return true;
  if (!current) return false;
  return incoming < current;
}

export function matchesInboxFilters(
  row: Pick<ApiConversation, "status" | "brand_id">,
  filters: InboxListFilters,
): boolean {
  if (row.status !== filters.status) return false;
  if (filters.brandId !== "all" && row.brand_id !== filters.brandId) return false;
  return true;
}

function sortByRecency(a: ApiConversation, b: ApiConversation): number {
  const at = a.last_message_at || a.updated_at || "";
  const bt = b.last_message_at || b.updated_at || "";
  if (at === bt) return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  return at < bt ? 1 : -1;
}

function brandStub(brandId: number, name: string, existing?: ApiBrand): ApiBrand {
  return {
    id: brandId,
    name,
    domain: existing?.domain ?? null,
    timezone: existing?.timezone ?? null,
    color: existing?.color ?? "#000",
    public_id: existing?.public_id ?? "",
  };
}

/**
 * Apply an authorized inbox summary to the list without inventing unread counts.
 * Rejects stale versions; removes rows that no longer match filters; dedupes by id.
 */
export function applyInboxSummary(
  rows: ApiConversation[],
  summary: InboxSummary,
  filters: InboxListFilters,
  brandNameById?: Map<number, string>,
): ApiConversation[] {
  const existing = rows.find((r) => r.id === summary.id);
  if (existing && isStaleInboxVersion(summary.version, conversationVersion(existing))) {
    return rows;
  }

  const nextRow: ApiConversation = {
    id: summary.id,
    brand_id: summary.brand_id,
    visitor_name: summary.visitor_name,
    page: summary.page,
    status: summary.status,
    // Unread stays authoritative via HTTP reconcile — never invent from fan-out events.
    unread_count: existing?.unread_count ?? 0,
    last_message_preview: summary.last_message_preview,
    last_message_at: summary.last_message_at,
    updated_at: summary.updated_at || summary.version,
  };

  if (existing?.brand) {
    nextRow.brand = existing.brand;
  } else if (brandNameById?.has(summary.brand_id)) {
    nextRow.brand = brandStub(summary.brand_id, brandNameById.get(summary.brand_id)!);
  }

  const without = rows.filter((r) => r.id !== summary.id);
  if (!matchesInboxFilters(nextRow, filters)) {
    return without;
  }

  return [nextRow, ...without].sort(sortByRecency);
}

/**
 * Merge an HTTP list (authoritative unread + membership) with live rows,
 * keeping the newer version per conversation id and re-applying filters.
 */
export function mergeInboxLists(
  httpList: ApiConversation[],
  liveRows: ApiConversation[],
  filters: InboxListFilters,
): ApiConversation[] {
  const byId = new Map<string, ApiConversation>();

  for (const row of httpList) {
    byId.set(row.id, row);
  }

  for (const live of liveRows) {
    const current = byId.get(live.id);
    if (!current) {
      byId.set(live.id, live);
      continue;
    }
    if (isStaleInboxVersion(conversationVersion(live), conversationVersion(current))) {
      continue;
    }
    const merged: ApiConversation = {
      ...current,
      ...live,
      unread_count: current.unread_count,
    };
    if (live.brand) merged.brand = live.brand;
    else if (current.brand) merged.brand = current.brand;
    byId.set(live.id, merged);
  }

  return [...byId.values()].filter((r) => matchesInboxFilters(r, filters)).sort(sortByRecency);
}
