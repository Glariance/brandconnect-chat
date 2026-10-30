/**
 * Exact origin allowlisting (scheme + host + optional port).
 * Mirrors api/app/Support/OriginAllowlist.php — keep rules in sync.
 */

export class OriginValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OriginValidationError";
  }
}

function isLocalhostHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1";
}

export function normalizeOrigin(origin: string, allowLocalhostHttp = false): string {
  const trimmed = origin.trim();
  if (!trimmed) throw new OriginValidationError("Origin must not be empty.");
  if (trimmed.includes("*")) throw new OriginValidationError("Wildcard origins are not allowed.");
  if (/\s/.test(trimmed)) throw new OriginValidationError("Origins must not contain whitespace.");

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new OriginValidationError("Origin must be an absolute URL with scheme and host.");
  }

  if (url.username || url.password) {
    throw new OriginValidationError("Origins must not include credentials.");
  }
  if (url.search || url.hash) {
    throw new OriginValidationError("Origins must not include query or fragment.");
  }
  if (url.pathname && url.pathname !== "/") {
    throw new OriginValidationError("Origins must not include a path.");
  }

  const scheme = url.protocol.replace(/:$/, "").toLowerCase();
  if (scheme !== "http" && scheme !== "https") {
    throw new OriginValidationError("Origin scheme must be http or https.");
  }

  const host = url.hostname.toLowerCase();
  if (!host || host.includes("*")) {
    throw new OriginValidationError("Origin host is invalid.");
  }

  let port = url.port ? Number(url.port) : null;
  if (port != null && (port < 1 || port > 65535)) {
    throw new OriginValidationError("Origin port is invalid.");
  }
  if ((scheme === "http" && port === 80) || (scheme === "https" && port === 443)) {
    port = null;
  }

  if (scheme === "http" && isLocalhostHost(host) && !allowLocalhostHttp) {
    throw new OriginValidationError("HTTP localhost origins require WIDGET_ALLOW_LOCALHOST_ORIGINS.");
  }

  return port == null ? `${scheme}://${host}` : `${scheme}://${host}:${port}`;
}

export function normalizeOriginList(origins: string[], allowLocalhostHttp = false): string[] {
  const map = new Map<string, string>();
  for (const origin of origins) {
    const normalized = normalizeOrigin(origin, allowLocalhostHttp);
    map.set(normalized, normalized);
  }
  return [...map.values()];
}

export function originAllowed(allowed: string[], origin: string): boolean {
  try {
    const normalized = normalizeOrigin(origin, true);
    return allowed.includes(normalized);
  } catch {
    return false;
  }
}

/** Build CSP frame-ancestors value; empty allowlist fails closed. */
export function frameAncestorsCspValue(origins: string[]): string {
  if (origins.length === 0) return "frame-ancestors 'none'";
  return `frame-ancestors ${origins.join(" ")}`;
}
