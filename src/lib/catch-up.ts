import type { ApiMessage, CursorPage } from "@/lib/chat-api";
import { latestServerId, mergeMessages } from "@/lib/message-utils";

export type CatchUpFetcher = (params: {
  after_id: number;
  cursor?: string;
}) => Promise<CursorPage<ApiMessage>>;

export type CatchUpResult = {
  /** All messages successfully fetched via HTTP in this drain, ascending by id. */
  messages: ApiMessage[];
  /** True only when every page completed and no further cursor remains. */
  complete: boolean;
  /**
   * Highest server id confirmed by HTTP in this drain.
   * Safe recovery position for the next after_id — never derived from Echo arrivals.
   * Undefined when no HTTP messages were fetched.
   */
  confirmedThroughId: number | undefined;
};

export type CatchUpOptions = {
  signal?: AbortSignal | undefined;
  onPage?: ((pageMessages: ApiMessage[], mergedSoFar: ApiMessage[]) => void) | undefined;
};

/**
 * Drain catch-up pages in ascending order after `afterId`.
 * Does not advance past a failed/unfilled page (complete=false on abort/error/gap).
 * `onPage` is invoked after each successful page so realtime arrivals can merge concurrently.
 */
export async function drainCatchUpAfter(
  afterId: number,
  fetchPage: CatchUpFetcher,
  options?: CatchUpOptions,
): Promise<CatchUpResult> {
  let cursor: string | undefined;
  let merged: ApiMessage[] = [];

  for (;;) {
    if (options?.signal?.aborted) {
      return {
        messages: merged,
        complete: false,
        confirmedThroughId: latestServerId(merged),
      };
    }

    let page: CursorPage<ApiMessage>;
    try {
      page = await fetchPage({
        after_id: afterId,
        ...(cursor ? { cursor } : {}),
      });
    } catch {
      return {
        messages: merged,
        complete: false,
        confirmedThroughId: latestServerId(merged),
      };
    }

    if (options?.signal?.aborted) {
      return {
        messages: merged,
        complete: false,
        confirmedThroughId: latestServerId(merged),
      };
    }

    merged = mergeMessages(merged, page.data);
    options?.onPage?.(page.data, merged);

    if (!page.nextCursor) {
      return {
        messages: merged,
        complete: true,
        confirmedThroughId: latestServerId(merged),
      };
    }

    // An empty page with a next cursor would leave a gap — stop without claiming completion.
    if (page.data.length === 0) {
      return {
        messages: merged,
        complete: false,
        confirmedThroughId: latestServerId(merged),
      };
    }

    cursor = page.nextCursor;
  }
}

/**
 * HTTP-only sync watermark. Echo / display max must never advance this.
 * Catch-up retries always use this value as after_id.
 */
export class HttpSyncWatermark {
  private value: number | undefined;

  get current(): number | undefined {
    return this.value;
  }

  /** Replace watermark (initial HTTP load or conversation switch). */
  reset(id: number | undefined): void {
    this.value = id;
  }

  /** Advance only from confirmed HTTP catch-up pages. */
  advanceFromHttp(confirmedThroughId: number | undefined): void {
    if (confirmedThroughId == null) return;
    if (this.value == null || confirmedThroughId > this.value) {
      this.value = confirmedThroughId;
    }
  }
}

/**
 * Apply a catch-up result: merge HTTP messages into display, advance watermark from HTTP only,
 * and report whether recovery is complete (safe to stop polling / mark read through watermark).
 */
export function applyCatchUpResult(
  watermark: HttpSyncWatermark,
  display: ApiMessage[],
  result: CatchUpResult,
  echoArrivals: ApiMessage[] = [],
): { display: ApiMessage[]; complete: boolean; readThroughId: number | undefined } {
  const withHttp = mergeMessages(display, result.messages);
  const withEcho = mergeMessages(withHttp, echoArrivals);
  watermark.advanceFromHttp(result.confirmedThroughId);
  return {
    display: withEcho,
    complete: result.complete,
    // Never mark read past the HTTP watermark / unfilled gap.
    readThroughId: result.complete ? watermark.current : undefined,
  };
}
