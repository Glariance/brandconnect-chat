import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";

const loader = readFileSync("public/widget.js", "utf8");

describe("widget close messages", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    delete (window as Window & { __bcWidget?: boolean }).__bcWidget;
    const script = document.createElement("script");
    script.src = "https://chat.example.com/widget.js";
    script.setAttribute("data-brand-id", "test-brand");
    Object.defineProperty(document, "currentScript", { configurable: true, value: script });
    new Function(loader)();
  });

  it("ignores a same-origin message from a different window", () => {
    const frame = document.querySelector("iframe")!;
    document.querySelector("button")!.click();
    window.dispatchEvent(new MessageEvent("message", {
      origin: "https://chat.example.com", source: window, data: "bc:close",
    }));
    expect(frame.style.display).toBe("block");
  });

  it("accepts a close message from its own iframe and expected origin", () => {
    const frame = document.querySelector("iframe")!;
    document.querySelector("button")!.click();
    window.dispatchEvent(new MessageEvent("message", {
      origin: "https://chat.example.com", source: frame.contentWindow, data: "bc:close",
    }));
    expect(frame.style.display).toBe("none");
  });

  it("ignores a message from the iframe with the wrong origin", () => {
    const frame = document.querySelector("iframe")!;
    document.querySelector("button")!.click();
    window.dispatchEvent(new MessageEvent("message", {
      origin: "https://other.example.com", source: frame.contentWindow, data: "bc:close",
    }));
    expect(frame.style.display).toBe("block");
  });
});
