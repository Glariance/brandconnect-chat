import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import { brands as sampleBrands } from "@/lib/sample-data";
import {
  friendlyWidgetConfigMessage,
  isSampleBrandPublicId,
  resolveRealModeBrandPublicId,
} from "@/lib/widget-demo";

describe("real-mode demo brand selection", () => {
  it("preserves a real public ID that is absent from sample-data", () => {
    const realId = "brd_live_9f2e41";
    expect(sampleBrands.some((b) => b.publicId === realId)).toBe(false);
    expect(isSampleBrandPublicId(realId, sampleBrands.map((b) => b.publicId))).toBe(false);

    // Must never fall back to nw_7f3a91 / another sample brand.
    expect(resolveRealModeBrandPublicId(realId)).toBe(realId);
    expect(resolveRealModeBrandPublicId(`  ${realId}  `)).toBe(realId);
    expect(resolveRealModeBrandPublicId(realId)).not.toBe(sampleBrands[0]?.publicId);
  });

  it("returns null for a missing brand query param instead of substituting a sample ID", () => {
    expect(resolveRealModeBrandPublicId("")).toBeNull();
    expect(resolveRealModeBrandPublicId("   ")).toBeNull();
  });

  it("shows a friendly setup message for 404 without raw Laravel model errors", () => {
    const raw = new ApiError(
      404,
      "No query results for model [App\\Models\\Brand] brd_doesnotexist",
    );
    const message = friendlyWidgetConfigMessage(raw);
    expect(message).toMatch(/wasn't found|brand ID/i);
    expect(message).not.toMatch(/No query results|App\\Models\\Brand|SQLSTATE/i);
  });

  it("uses generic copy for other API failures that look like ORM dumps", () => {
    const raw = new ApiError(500, "SQLSTATE[HY000] stack trace …");
    const message = friendlyWidgetConfigMessage(raw);
    expect(message).not.toMatch(/SQLSTATE|stack trace/i);
    expect(message).toMatch(/couldn't load|try again/i);
  });
});
