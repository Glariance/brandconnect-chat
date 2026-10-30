import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "public/widget.js"), "utf8");

describe("widget.js loader hardening", () => {
  it("compares message origin to the script origin", () => {
    expect(source).toMatch(/e\.origin\s*!==\s*origin/);
  });

  it("requires the iframe contentWindow as message source", () => {
    expect(source).toMatch(/e\.source\s*!==\s*frame\.contentWindow/);
  });

  it("accepts structured close messages with an explicit source marker", () => {
    expect(source).toMatch(/brandconnect-widget/);
    expect(source).toMatch(/bc:close/);
  });

  it("boots presence without requiring the chat popup to open", () => {
    expect(source).not.toMatch(/style\.display\s*=\s*["']none["']/);
    expect(source).toMatch(/frame\.style\.display = "block"/);
    expect(source).toMatch(/bc:chat-state/);
    expect(source).toMatch(/bc:page/);
    expect(source).toMatch(/bc:host-visibility/);
    expect(source).toMatch(/bc:widget-ready/);
    expect(source).toMatch(/bc:host-state/);
    expect(source).toMatch(/replayHostState/);
    expect(source).toMatch(/__bcWidgetBooted/);
    expect(source).toMatch(/left = "-10000px"/);
  });

  it("registers the iframe load listener before assigning src", () => {
    const loadIdx = source.indexOf('frame.addEventListener("load"');
    const srcIdx = source.indexOf("frame.src =");
    expect(loadIdx).toBeGreaterThan(-1);
    expect(srcIdx).toBeGreaterThan(loadIdx);
  });

  it("supports an opt-in consent gate without putting credentials in the DOM", () => {
    expect(source).toMatch(/data-require-consent/);
    expect(source).toMatch(/trackingConsent/);
    expect(source).not.toMatch(/Bearer/);
    expect(source).not.toMatch(/token=/);
  });

  it("patches history once for SPA page updates", () => {
    expect(source).toMatch(/historyPatched/);
    expect(source).toMatch(/pushState/);
    expect(source).toMatch(/replaceState/);
  });
});
