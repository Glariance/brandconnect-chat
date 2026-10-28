import { ApiError } from "@/lib/api";

/**
 * In real mode the URL brand ID must be preserved exactly.
 * Never substitute a sample/public fallback when the ID is unknown.
 */
export function resolveRealModeBrandPublicId(urlBrand: string): string | null {
  const id = urlBrand.trim();
  return id.length > 0 ? id : null;
}

/** Friendly setup copy — never surface raw Laravel model / stack messages. */
export function friendlyWidgetConfigMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 404) {
      return "This brand ID wasn't found. Check the install snippet or create the brand in the dashboard.";
    }
    if (error.status === 401 || error.status === 403) {
      return "This brand isn't available for public chat right now.";
    }
    // Prefer generic copy over raw ORM messages like "No query results for model …".
    if (/no query results|model \[|sqlstate|stack trace/i.test(error.message)) {
      return "We couldn't load this brand's chat widget. Check the brand ID and try again.";
    }
  }
  return "We couldn't load this brand's chat widget. Check the brand ID and try again.";
}

export function isSampleBrandPublicId(
  publicId: string,
  samplePublicIds: readonly string[],
): boolean {
  return samplePublicIds.includes(publicId);
}
