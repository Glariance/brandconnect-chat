import { afterEach, describe, expect, it, vi } from "vitest";

describe("CSRF bootstrap coalescing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("shares one Sanctum csrf-cookie request across parallel api callers", async () => {
    let csrfCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/sanctum/csrf-cookie")) {
          csrfCalls += 1;
          await new Promise((r) => setTimeout(r, 20));
          return new Response(null, {
            status: 204,
            headers: { "Set-Cookie": "XSRF-TOKEN=test; Path=/" },
          });
        }
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    vi.stubGlobal("document", {
      cookie: "XSRF-TOKEN=test",
    });

    const { api, resetCsrf } = await import("@/lib/api");
    resetCsrf();

    await Promise.all([
      api("/brands"),
      api("/conversations"),
      api("/auth/me"),
    ]);

    expect(csrfCalls).toBe(1);
  });
});
