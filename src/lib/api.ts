/** Credentialed API client for dashboard (Sanctum cookies) and visitor Bearer auth. */

const viteEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};
const API_URL = (viteEnv["VITE_API_URL"] ?? "http://localhost:8000").replace(/\/$/, "");

export const isRealChatEnabled = () =>
  String(viteEnv["VITE_REAL_CHAT"] ?? "true").toLowerCase() !== "false";

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

let csrfReady = false;

async function ensureCsrf(): Promise<void> {
  if (csrfReady) return;
  const res = await fetch(`${API_URL}/sanctum/csrf-cookie`, {
    method: "GET",
    credentials: "include",
  });
  if (!res.ok) {
    throw new ApiError(res.status, "Could not initialize CSRF cookie");
  }
  csrfReady = true;
}

export function xsrfToken(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
  return match ? decodeURIComponent(match[1]!) : null;
}

type RequestOpts = {
  method?: string | undefined;
  body?: unknown;
  bearer?: string | null | undefined;
  /** Skip CSRF bootstrap (GET-only public endpoints). */
  public?: boolean | undefined;
  signal?: AbortSignal | undefined;
  /** Absolute path under the API origin (defaults to /api/v1 + path). */
  absolutePath?: string | undefined;
};

export async function api<T = unknown>(path: string, opts: RequestOpts = {}): Promise<T> {
  const method = opts.method ?? (opts.body ? "POST" : "GET");
  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  if (!opts.public && !opts.bearer) {
    await ensureCsrf();
    const token = xsrfToken();
    if (token) headers["X-XSRF-TOKEN"] = token;
  }

  if (opts.bearer) {
    headers["Authorization"] = `Bearer ${opts.bearer}`;
  }

  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const url = opts.absolutePath
    ? `${API_URL}${opts.absolutePath}`
    : `${API_URL}/api/v1${path}`;

  const init: RequestInit = {
    method,
    credentials: opts.bearer ? "omit" : "include",
    headers,
  };
  const body = opsBody(opts.body);
  if (body !== undefined) init.body = body;
  if (opts.signal) init.signal = opts.signal;

  const res = await fetch(url, init);

  if (res.status === 204) {
    return undefined as T;
  }

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    const msg =
      typeof data === "object" && data && "message" in data
        ? String((data as { message: unknown }).message)
        : `Request failed (${res.status})`;
    throw new ApiError(res.status, msg, data);
  }

  return data as T;
}

function opsBody(body: unknown): string | undefined {
  if (body === undefined) return undefined;
  return JSON.stringify(body);
}

export function apiBaseUrl(): string {
  return API_URL;
}

export function resetCsrf(): void {
  csrfReady = false;
}

export function reverbEnv() {
  return {
    key: viteEnv["VITE_REVERB_APP_KEY"] ?? "",
    host: viteEnv["VITE_REVERB_HOST"] ?? "localhost",
    port: Number(viteEnv["VITE_REVERB_PORT"] ?? 8081),
    scheme: viteEnv["VITE_REVERB_SCHEME"] ?? "http",
  };
}
