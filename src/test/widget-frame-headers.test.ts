import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { FAIL_CLOSED_FRAME_ANCESTORS, resolveWidgetFrameAncestors, widgetEmbedResponseHeaders } from "@/lib/widget-frame-headers";

describe("widget frame headers", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("brd_ok")) {
          return new Response(
            JSON.stringify({
              data: {
                allowed_origins: ["https://shop.example.com"],
                frame_ancestors: ["https://shop.example.com", "http://localhost:8080"],
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({ message: "Not found" }), { status: 404 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves brand frame ancestors from config", async () => {
    await expect(resolveWidgetFrameAncestors("brd_ok")).resolves.toEqual([
      "https://shop.example.com",
      "http://localhost:8080",
    ]);
  });

  it("fails closed for missing brands", async () => {
    await expect(resolveWidgetFrameAncestors("brd_missing")).resolves.toEqual([]);
    await expect(resolveWidgetFrameAncestors("")).resolves.toEqual([]);
  });

  it("sets CSP and no-store cache headers", () => {
    const headers = widgetEmbedResponseHeaders(["https://shop.example.com"]);
    expect(headers).toMatchObject({
      "Content-Security-Policy": "frame-ancestors https://shop.example.com",
      "Cache-Control": expect.stringContaining("no-store"),
    });
    expect(FAIL_CLOSED_FRAME_ANCESTORS).toBe("frame-ancestors 'none'");
  });
});
