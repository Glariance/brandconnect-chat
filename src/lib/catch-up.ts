import type { ApiMessage, CursorPage } from "@/lib/chat-api";
import { mergeMessages } from "@/lib/message-utils";

export type CatchUpFetcher = (params: {
  after_id: number;
  cursor?: string;
}) => Promise<CursorPage<ApiMessage>>;

export type CatchUpResult = {
  /** All messages successfully fetched, ascending by id. */
  messages: ApiMessage[];
  /** True only when every page completed and no further cursor remains. */
  complete: boolean;
};

/**
 * Drain catch-up pages in ascending order after `afterId`.
 * Does not advance past a failed/unfilled page (complete=false on abort/error/gap).
 * `onPage` is invoked after each successful page so realtime arrivals can merge concurrently.
 */
export type CatchUpOptions = {
  signal?: AbortSignal | undefined;
  onPage?: ((pageMessages: ApiMessage[], mergedSoFar: ApiMessage[]) => void) | undefined;
};

export async function drainCatchUpAfter(
  afterId: number,
  fetchPage: CatchUpFetcher,
  options?: CatchUpOptions,
): Promise<CatchUpResult> {
  let cursor: string | undefined;
  let merged: ApiMessage[] = [];

  for (;;) {
    if (options?.signal?.aborted) {
      return { messages: merged, complete: false };
    }

    let page: CursorPage<ApiMessage>;
    try {
      page = await fetchPage({
        after_id: afterId,
        ...(cursor ? { cursor } : {}),
      });
    } catch {
      return { messages: merged, complete: false };
    }

    if (options?.signal?.aborted) {
      return { messages: merged, complete: false };
    }

    // Pages must be ascending; reject / stop if the server returns nothing usable mid-stream with a cursor.
    merged = mergeMessages(merged, page.data);
    options?.onPage?.(page.data, merged);

    if (!page.nextCursor) {
      return { messages: merged, complete: true };
    }

    // An empty page with a next cursor would leave a gap — stop without claiming completion.
    if (page.data.length === 0) {
      return { messages: merged, complete: false };
    }

    cursor = page.nextCursor;
  }
}
