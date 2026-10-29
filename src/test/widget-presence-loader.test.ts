/**
 * Integration regression: actual public/widget.js loader boots presence without
 * clicking the launcher, and closed-popup chrome must not suppress heartbeats.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startVisitorPresence } from "@/lib/visitor-presence";

const loaderSource = readFileSync(resolve(process.cwd(), "public/widget.js"), "utf8");

function installLoader(opts?: { requireConsent?: boolean }) {
  document.body.innerHTML = "";
  // @ts-expect-error test reset
  window.__bcWidget = false;
  // @ts-expect-error test reset
  window.__bcWidgetBooted = false;

  const script = document.createElement("script");
  script.setAttribute("data-brand-id", "brd_testbrand");
  script.setAttribute("data-color", "#123");
  if (opts?.requireConsent) script.setAttribute("data-require-consent", "true");
  // widget.js reads document.currentScript + s.src origin
  Object.defineProperty(script, "src", {
    configurable: true,
    value: "http://localhost:8080/widget.js",
  });
  Object.defineProperty(document, "currentScript", {
    configurable: true,
    get: () => script,
  });

  // eslint-disable-next-line no-new-func
  const run = new Function(loaderSource);
  run();

  return script;
}

afterEach(() => {
  document.body.innerHTML = "";
  // @ts-expect-error test reset
  delete window.__bcWidget;
  // @ts-expect-error test reset
  delete window.__bcWidgetBooted;
  // @ts-expect-error cleanup
  delete window.BrandConnect;
});

describe("widget.js loader presence bootstrap (no launcher click)", () => {
  it("creates and navigates the iframe on page load without opening chat", () => {
    installLoader();
    const frame = document.querySelector('iframe[title="Chat with us"]') as HTMLIFrameElement | null;
    const btn = document.querySelector('button[aria-label="Open chat"]');
    expect(frame).toBeTruthy();
    expect(btn).toBeTruthy();
    expect(frame!.getAttribute("src") || frame!.src).toMatch(
      /\/widget\?brand=brd_testbrand&page=/,
    );
    // Closed: visually hidden, but still display:block so the document can boot.
    expect(frame!.style.display).toBe("block");
    expect(frame!.style.opacity).toBe("0");
    expect(frame!.style.pointerEvents).toBe("none");
    expect(loaderSource).not.toMatch(/style\.display\s*=\s*["']none["']/);
  });

  it("does not require consent on the default demo install path", () => {
    expect(loaderSource).toMatch(/data-require-consent/);
    installLoader({ requireConsent: false });
    expect(document.querySelector("iframe")).toBeTruthy();
  });

  it("defers boot when data-require-consent is set until consent is granted", () => {
    installLoader({ requireConsent: true });
    expect(document.querySelector("iframe")).toBeNull();
    // @ts-expect-error BrandConnect hook
    expect(typeof window.BrandConnect?.enableTracking).toBe("function");
    // @ts-expect-error BrandConnect hook
    window.BrandConnect.enableTracking();
    expect(document.querySelector("iframe")).toBeTruthy();
  });

  it("posts host-visibility (not chat-open) to the iframe", () => {
    expect(loaderSource).toMatch(/bc:host-visibility/);
    expect(loaderSource).toMatch(/visibilitychange/);
    expect(loaderSource).toMatch(/notifyHostVisibility/);
  });
});

describe("visitor presence host visibility", () => {
  it("sends an immediate heartbeat even when the iframe document would be hidden", async () => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });

    const posts: unknown[] = [];
    const ctl = startVisitorPresence({
      token: "tok",
      initialPage: "/pricing?x=1",
      hostVisible: true,
      chatOpened: false,
      heartbeatMs: 60_000,
      postPresence: async (_token, body) => {
        posts.push(body);
        return {
          visitor_id: 1,
          brand_id: 1,
          brand_name: "A",
          label: "Visitor #1",
          page: String(body.page ?? "/"),
          first_seen_at: null,
          last_seen_at: null,
          status: "active",
          chat_opened: Boolean(body.chat_opened),
          tab_count: 1,
          version: "v1",
        };
      },
    });

    await vi.waitFor(() => expect(posts.length).toBeGreaterThanOrEqual(1));
    expect(posts[0]).toMatchObject({
      page: "/pricing",
      chat_opened: false,
      activity: true,
    });
    expect(ctl.hostVisible).toBe(true);

    // Opening the popup must not be required for presence.
    ctl.setChatOpened(true);
    await vi.waitFor(() => expect(posts.length).toBeGreaterThanOrEqual(2));
    expect((posts[1] as { chat_opened: boolean }).chat_opened).toBe(true);

    ctl.stop();
  });

  it("pauses when the host page is hidden and resumes without waiting for the interval", async () => {
    const posts: unknown[] = [];
    const ctl = startVisitorPresence({
      token: "tok",
      initialPage: "/",
      hostVisible: true,
      heartbeatMs: 60_000,
      postPresence: async (_token, body) => {
        posts.push(body);
        return {
          visitor_id: 1,
          brand_id: 1,
          brand_name: "A",
          label: "V",
          page: "/",
          first_seen_at: null,
          last_seen_at: null,
          status: "active",
          chat_opened: false,
          tab_count: 1,
          version: "v",
        };
      },
    });

    await vi.waitFor(() => expect(posts.length).toBe(1));
    ctl.setHostVisible(false);
    const n = posts.length;
    ctl.setPage("/other");
    // Host hidden → no beat despite page change scheduling attempt via setPage
    await new Promise((r) => setTimeout(r, 30));
    expect(posts.length).toBe(n);

    ctl.setHostVisible(true);
    await vi.waitFor(() => expect(posts.length).toBeGreaterThan(n));
    ctl.stop();
  });
});
