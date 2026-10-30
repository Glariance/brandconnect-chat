import { describe, expect, it } from "vitest";
import {
  frameAncestorsCspValue,
  normalizeOrigin,
  normalizeOriginList,
  originAllowed,
  OriginValidationError,
} from "@/lib/origin-allowlist";

describe("origin allowlist", () => {
  it("normalizes scheme/host/port and strips default ports", () => {
    expect(normalizeOrigin("https://Shop.Example.com/")).toBe("https://shop.example.com");
    expect(normalizeOrigin("https://shop.example.com:443")).toBe("https://shop.example.com");
    expect(normalizeOrigin("http://localhost:8080", true)).toBe("http://localhost:8080");
  });

  it("keeps www and apex distinct", () => {
    expect(normalizeOriginList(["https://www.example.com", "https://example.com"])).toEqual([
      "https://www.example.com",
      "https://example.com",
    ]);
  });

  it("rejects wildcards, credentials, paths, and bad ports", () => {
    for (const bad of [
      "https://*.example.com",
      "https://user:pass@example.com",
      "https://example.com/path",
      "https://example.com?x=1",
      "https://shop.example.com.evil.test/https://shop.example.com",
    ]) {
      expect(() => normalizeOrigin(bad, true)).toThrow(OriginValidationError);
    }
  });

  it("rejects incorrect ports via exact allow check", () => {
    const allowed = ["https://shop.example.com"];
    expect(originAllowed(allowed, "https://shop.example.com")).toBe(true);
    expect(originAllowed(allowed, "https://shop.example.com:8443")).toBe(false);
    expect(originAllowed(allowed, "https://www.shop.example.com")).toBe(false);
  });

  it("builds fail-closed CSP when empty", () => {
    expect(frameAncestorsCspValue([])).toBe("frame-ancestors 'none'");
    expect(frameAncestorsCspValue(["https://a.example.com", "http://localhost:8080"])).toBe(
      "frame-ancestors https://a.example.com http://localhost:8080",
    );
  });
});
