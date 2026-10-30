import { frameAncestorsCspValue } from "@/lib/origin-allowlist";

const FAIL_CLOSED = frameAncestorsCspValue([]);

function apiBase(): string {
  return String(import.meta.env.VITE_API_URL ?? "http://localhost:8000").replace(/\/$/, "");
}

function previewOriginsFromEnv(): string[] {
  const raw = String(import.meta.env.VITE_WIDGET_PREVIEW_ORIGINS ?? "").trim();
  if (raw) {
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
  }
  // Default local preview hosts (explicit operator defaults for widget-demo).
  return ["http://localhost:8080", "http://127.0.0.1:8080"];
}

type WidgetConfigPayload = {
  data?: {
    frame_ancestors?: string[];
    allowed_origins?: string[];
  };
};

/**
 * Resolve frame-ancestors for /widget?brand=… by calling the public widget config API.
 * Missing/invalid brands fail closed (`'none'`).
 */
export async function resolveWidgetFrameAncestors(publicId: string, signal?: AbortSignal): Promise<string[]> {
  const id = publicId.trim();
  if (!id) return [];

  try {
    const init: RequestInit = {
      method: "GET",
      headers: { Accept: "application/json" },
    };
    if (signal) init.signal = signal;
    const res = await fetch(`${apiBase()}/api/v1/widget/brands/${encodeURIComponent(id)}/config`, init);
    if (!res.ok) return [];
    const json = (await res.json()) as WidgetConfigPayload;
    const fromApi = json.data?.frame_ancestors;
    if (Array.isArray(fromApi) && fromApi.every((x) => typeof x === "string")) {
      return fromApi;
    }
    // Older API fallback: merge allowed_origins with local preview env.
    const allowed = Array.isArray(json.data?.allowed_origins) ? json.data.allowed_origins : [];
    return [...new Set([...allowed, ...previewOriginsFromEnv()])];
  } catch {
    return [];
  }
}

export function widgetEmbedResponseHeaders(ancestors: string[]): HeadersInit {
  return {
    "Content-Security-Policy": frameAncestorsCspValue(ancestors),
    "Cache-Control": "private, no-store, no-cache, must-revalidate",
    Pragma: "no-cache",
    Vary: "Origin",
  };
}

export function dashboardFrameHeaders(): HeadersInit {
  return {
    "Content-Security-Policy": FAIL_CLOSED,
  };
}

export { FAIL_CLOSED as FAIL_CLOSED_FRAME_ANCESTORS };
