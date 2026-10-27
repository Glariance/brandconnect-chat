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
});
