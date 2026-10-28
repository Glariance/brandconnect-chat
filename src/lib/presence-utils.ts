export type LiveVisitor = {
  visitor_id: number;
  brand_id: number;
  brand_name: string | null;
  label: string;
  page: string;
  first_seen_at: string | null;
  last_seen_at: string | null;
  status: "active" | "idle" | "offline";
  chat_opened: boolean;
  tab_count: number;
  version: string;
};

export type PresenceListFilters = {
  brandId: number | "all";
};

/** Strip query/fragment; keep path only. */
export function sanitizePagePath(page: string | null | undefined): string {
  if (!page) return "/";
  const raw = page.trim();
  if (!raw) return "/";
  try {
    if (raw.includes("://")) {
      const u = new URL(raw);
      return (u.pathname || "/").slice(0, 500) || "/";
    }
  } catch {
    /* fall through */
  }
  const path = raw.split(/[?#]/)[0] || "/";
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return normalized.slice(0, 500) || "/";
}

export function liveVisitorFromBroadcast(payload: unknown): { visitor: LiveVisitor; reason: string } | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as { visitor?: unknown; reason?: unknown };
  const v = root.visitor;
  if (!v || typeof v !== "object") return null;
  const row = v as Record<string, unknown>;
  const visitorId = row["visitor_id"];
  const brandId = row["brand_id"];
  if (typeof visitorId !== "number" || typeof brandId !== "number") return null;
  const status = row["status"];
  if (status !== "active" && status !== "idle" && status !== "offline") return null;
  const version =
    typeof row["version"] === "string"
      ? row["version"]
      : typeof row["last_seen_at"] === "string"
        ? row["last_seen_at"]
        : null;
  if (!version) return null;

  return {
    reason: typeof root.reason === "string" ? root.reason : "updated",
    visitor: {
      visitor_id: visitorId,
      brand_id: brandId,
      brand_name: typeof row["brand_name"] === "string" ? row["brand_name"] : null,
      label: typeof row["label"] === "string" ? row["label"] : `Visitor #${visitorId}`,
      page: typeof row["page"] === "string" ? row["page"] : "/",
      first_seen_at: typeof row["first_seen_at"] === "string" ? row["first_seen_at"] : null,
      last_seen_at: typeof row["last_seen_at"] === "string" ? row["last_seen_at"] : null,
      status,
      chat_opened: Boolean(row["chat_opened"]),
      tab_count: typeof row["tab_count"] === "number" ? row["tab_count"] : 0,
      version,
    },
  };
}

function isStale(incoming: string, current: string): boolean {
  if (!incoming) return true;
  if (!current) return false;
  return incoming < current;
}

export function matchesPresenceFilters(row: LiveVisitor, filters: PresenceListFilters): boolean {
  if (row.status === "offline") return false;
  if (filters.brandId !== "all" && row.brand_id !== filters.brandId) return false;
  return true;
}

export function applyPresenceUpdate(
  rows: LiveVisitor[],
  visitor: LiveVisitor,
  reason: string,
  filters: PresenceListFilters,
): LiveVisitor[] {
  const existing = rows.find((r) => r.visitor_id === visitor.visitor_id);
  if (existing && isStale(visitor.version, existing.version)) {
    return rows;
  }

  const without = rows.filter((r) => r.visitor_id !== visitor.visitor_id);
  if (reason === "offline" || visitor.status === "offline" || !matchesPresenceFilters(visitor, filters)) {
    return without;
  }

  return [visitor, ...without].sort((a, b) => {
    const at = a.last_seen_at || "";
    const bt = b.last_seen_at || "";
    return at < bt ? 1 : at > bt ? -1 : 0;
  });
}

export function mergePresenceLists(
  httpList: LiveVisitor[],
  liveRows: LiveVisitor[],
  filters: PresenceListFilters,
): LiveVisitor[] {
  const byId = new Map<number, LiveVisitor>();
  for (const row of httpList) {
    if (matchesPresenceFilters(row, filters)) byId.set(row.visitor_id, row);
  }
  for (const live of liveRows) {
    if (!matchesPresenceFilters(live, filters)) continue;
    const current = byId.get(live.visitor_id);
    if (!current || !isStale(live.version, current.version)) {
      byId.set(live.visitor_id, live);
    }
  }
  return [...byId.values()].sort((a, b) => {
    const at = a.last_seen_at || "";
    const bt = b.last_seen_at || "";
    return at < bt ? 1 : at > bt ? -1 : 0;
  });
}

export function formatPresenceTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return "—";
  }
}

export function formatTimeOnSite(firstSeen: string | null, lastSeen: string | null): string {
  if (!firstSeen || !lastSeen) return "—";
  try {
    const ms = Math.max(0, new Date(lastSeen).getTime() - new Date(firstSeen).getTime());
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m`;
    return `${Math.floor(min / 60)}h ${min % 60}m`;
  } catch {
    return "—";
  }
}

export function newTabId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "00000000-0000-4000-8000-000000000001";
}
