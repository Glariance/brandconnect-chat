import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { PageHeader, Badge, Btn, Card, Table } from "@/components/app-shell";
import { AgentComposer } from "@/components/agent-composer";
import { VisitorArrivalControls } from "@/components/visitor-arrival-controls";
import { visitors as sampleVisitors } from "@/lib/sample-data";
import { ApiError, isAbortError, isRealChatEnabled } from "@/lib/api";
import {
  fetchBrands,
  fetchLiveVisitors,
  fetchSavedReplies,
  newClientMessageId,
  postLiveVisitorMessage,
  type ApiLiveVisitor,
  type ApiSavedReply,
} from "@/lib/chat-api";
import { parseBrandFilterId, useBrandFilter } from "@/lib/brand-filter";
import { PendingSendRegistry } from "@/lib/message-utils";
import { announceVisitorArrival } from "@/lib/visitor-arrival-notify";
import { createVisitorArrivalTracker } from "@/lib/visitor-arrival-tracker";
import {
  acquireAgentEcho,
  realtimeStatusLabel,
  releaseAgentEcho,
  startBoundedMessagePolling,
  subscribeToBrandPresence,
  type BrandChannelSubscription,
  type EchoLike,
  type RealtimeStatus,
} from "@/lib/echo-client";
import {
  applyPresenceUpdate,
  formatPresenceTime,
  formatTimeOnSite,
  liveVisitorFromBroadcast,
  mergePresenceLists,
  type LiveVisitor,
  type PresenceListFilters,
} from "@/lib/presence-utils";

export const Route = createFileRoute("/visitors")({
  head: () => ({
    meta: [
      { title: "Live Visitors · BrandConnect" },
      { name: "description", content: "See who is browsing each brand's site right now." },
      { property: "og:title", content: "Live Visitors · BrandConnect" },
      { property: "og:description", content: "See who is browsing each brand's site right now." },
    ],
  }),
  component: Page,
});

function Page() {
  return isRealChatEnabled() ? <RealLiveVisitors /> : <DemoLiveVisitors />;
}

function DemoLiveVisitors() {
  return (
    <>
      <PageHeader title="Live Visitors" desc={`${sampleVisitors.length} visitors online now`} />
      <Table
        head={["Visitor", "Brand", "Current page", "Time on site", "Location", "Source", ""]}
        rows={sampleVisitors.map((v) => [
          <span key="l" className="font-medium">{v.label}</span>,
          v.brand,
          <code key="p" className="text-xs">{v.page}</code>,
          v.time,
          v.location,
          v.source,
          <div key="a" className="flex justify-end gap-2">
            {v.returning && <Badge tone="primary">Returning</Badge>}
            <Btn variant="outline" disabled title="Demo mode">
              Message
            </Btn>
          </div>,
        ])}
      />
    </>
  );
}

function toLive(row: ApiLiveVisitor): LiveVisitor {
  return {
    visitor_id: row.visitor_id,
    brand_id: row.brand_id,
    brand_name: row.brand_name,
    label: row.label,
    page: row.page,
    first_seen_at: row.first_seen_at,
    last_seen_at: row.last_seen_at,
    status: row.status,
    chat_opened: row.chat_opened,
    tab_count: row.tab_count,
    version: row.version || row.last_seen_at || "",
  };
}

function RealLiveVisitors() {
  const { brandId: brandFilterRaw } = useBrandFilter();
  const brandFilter = parseBrandFilterId(brandFilterRaw);
  const [rows, setRows] = useState<LiveVisitor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [realtime, setRealtime] = useState<RealtimeStatus>("connecting");
  const [dmTarget, setDmTarget] = useState<LiveVisitor | null>(null);
  const [dmDraft, setDmDraft] = useState("");
  const [dmSending, setDmSending] = useState(false);
  const [dmError, setDmError] = useState<string | null>(null);
  const [dmReplies, setDmReplies] = useState<ApiSavedReply[]>([]);
  const dmPendingRef = useRef(new PendingSendRegistry());
  const arrivalTrackerRef = useRef(createVisitorArrivalTracker());
  /** Skip alerts until first successful hydrate for the current filter. */
  const baselineReadyRef = useRef(false);

  const echoRef = useRef<EchoLike | null>(null);
  const echoReadyRef = useRef(false);
  const subsRef = useRef<BrandChannelSubscription[]>([]);
  const listAbortRef = useRef<AbortController | null>(null);
  const listPollStopRef = useRef<(() => void) | null>(null);
  const rowsRef = useRef<LiveVisitor[]>([]);
  const filtersRef = useRef<PresenceListFilters>({ brandId: brandFilter });
  const subscribedBrandIdsRef = useRef(new Set<number>());
  const expectedBrandIdsRef = useRef<number[]>([]);
  const reconciledRef = useRef(false);

  rowsRef.current = rows;
  filtersRef.current = { brandId: brandFilter };

  const stopListPolling = useCallback(() => {
    listPollStopRef.current?.();
    listPollStopRef.current = null;
  }, []);

  const announceArrivals = useCallback((arrivals: LiveVisitor[]) => {
    for (const v of arrivals) {
      void announceVisitorArrival(v);
    }
  }, []);

  const loadList = useCallback(async (opts?: { mergeLive?: boolean; seedBaseline?: boolean }) => {
    listAbortRef.current?.abort();
    const ac = new AbortController();
    listAbortRef.current = ac;
    const filters = { ...filtersRef.current };
    try {
      const params: { brand_id?: number } = {};
      if (filters.brandId !== "all") params.brand_id = filters.brandId;
      const page = await fetchLiveVisitors(params, { signal: ac.signal });
      if (ac.signal.aborted) return false;
      const http = page.data.map(toLive);
      const merged = opts?.mergeLive
        ? mergePresenceLists(http, rowsRef.current, filters)
        : mergePresenceLists(http, [], filters);
      setRows(merged);

      if (opts?.seedBaseline || !baselineReadyRef.current) {
        arrivalTrackerRef.current.resetBaseline(merged);
        baselineReadyRef.current = true;
      } else {
        announceArrivals(arrivalTrackerRef.current.noteRows(merged));
      }

      setError(null);
      return true;
    } catch (e) {
      if (isAbortError(e)) return false;
      if (e instanceof ApiError && e.status === 403) {
        for (const sub of subsRef.current) sub.leave();
        subsRef.current = [];
        subscribedBrandIdsRef.current.clear();
      }
      setError(e instanceof ApiError ? e.message : "Failed to load live visitors");
      if (!opts?.mergeLive) setRows([]);
      return false;
    } finally {
      setLoading(false);
    }
  }, [announceArrivals]);

  const startListPolling = useCallback(() => {
    if (listPollStopRef.current) return;
    listPollStopRef.current = startBoundedMessagePolling(() => {
      void loadList({ mergeLive: true });
    }, 5000);
  }, [loadList]);

  const maybeStopListPolling = useCallback(() => {
    const expected = expectedBrandIdsRef.current;
    const all =
      expected.length > 0 && expected.every((id) => subscribedBrandIdsRef.current.has(id));
    if (!all) return;
    setRealtime((s) => (s === "polling" || s === "connecting" ? "live" : s));
    if (reconciledRef.current) stopListPolling();
  }, [stopListPolling]);

  const onPresencePayload = useCallback((payload: unknown) => {
    const parsed = liveVisitorFromBroadcast(payload);
    if (!parsed) return;
    setRows((prev) => applyPresenceUpdate(prev, parsed.visitor, parsed.reason, filtersRef.current));
    if (!baselineReadyRef.current) return;
    const arrival = arrivalTrackerRef.current.noteUpdate(parsed.visitor, parsed.reason);
    if (arrival) void announceVisitorArrival(arrival);
  }, []);

  useEffect(() => {
    setLoading(true);
    reconciledRef.current = false;
    baselineReadyRef.current = false;
    arrivalTrackerRef.current = createVisitorArrivalTracker();
    void loadList({ mergeLive: false, seedBaseline: true }).then((ok) => {
      if (ok) {
        reconciledRef.current = true;
        maybeStopListPolling();
      }
    });
    startListPolling();
    return () => {
      listAbortRef.current?.abort();
      stopListPolling();
    };
  }, [brandFilter, loadList, startListPolling, stopListPolling, maybeStopListPolling]);

  useEffect(() => {
    let cancelled = false;
    setRealtime("connecting");
    echoReadyRef.current = false;
    void acquireAgentEcho()
      .then((echo) => {
        if (cancelled) {
          if (echo) releaseAgentEcho();
          return;
        }
        echoRef.current = echo;
        echoReadyRef.current = Boolean(echo);
        if (!echo) {
          startListPolling();
          setRealtime("polling");
        }
      })
      .catch(() => {
        if (!cancelled) {
          startListPolling();
          setRealtime("polling");
        }
      });
    return () => {
      cancelled = true;
      for (const sub of subsRef.current) sub.leave();
      subsRef.current = [];
      subscribedBrandIdsRef.current.clear();
      releaseAgentEcho();
      echoRef.current = null;
      echoReadyRef.current = false;
    };
    // Echo is acquired once for the Live Visitors mount; brand filters re-subscribe separately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    let brandsAbort: AbortController | null = null;

    const leaveSubs = () => {
      for (const sub of subsRef.current) sub.leave();
      subsRef.current = [];
      subscribedBrandIdsRef.current.clear();
    };

    const attach = async () => {
      while (!cancelled && !echoReadyRef.current) {
        await new Promise((r) => window.setTimeout(r, 50));
      }
      if (cancelled) return;
      const echo = echoRef.current;
      if (!echo) {
        startListPolling();
        setRealtime("polling");
        return;
      }

      brandsAbort = new AbortController();
      let brands: Awaited<ReturnType<typeof fetchBrands>>;
      try {
        brands = await fetchBrands({ signal: brandsAbort.signal });
      } catch (e) {
        if (isAbortError(e) || cancelled) return;
        startListPolling();
        setRealtime("polling");
        return;
      }
      if (cancelled) return;

      const allIds = brands.map((b) => b.id);
      const targetIds =
        brandFilter === "all" ? allIds : allIds.includes(brandFilter) ? [brandFilter] : [];

      leaveSubs();
      expectedBrandIdsRef.current = targetIds;
      reconciledRef.current = false;

      if (targetIds.length === 0) {
        startListPolling();
        void loadList({ mergeLive: true }).then((ok) => {
          if (ok) reconciledRef.current = true;
        });
        return;
      }

      const onDown = () => {
        startListPolling();
        setRealtime("polling");
      };

      for (const id of targetIds) {
        const sub = subscribeToBrandPresence(echo, id, {
          onPresence: onPresencePayload,
          onSubscribed: () => {
            if (cancelled || !sub.active) return;
            subscribedBrandIdsRef.current.add(id);
            void (async () => {
              const ok = await loadList({ mergeLive: true });
              if (cancelled || !sub.active) return;
              if (ok) {
                reconciledRef.current = true;
                maybeStopListPolling();
              } else {
                startListPolling();
              }
            })();
          },
          onSubscriptionError: () => {
            subscribedBrandIdsRef.current.delete(id);
            startListPolling();
          },
          onConnectionLost: onDown,
          subscriptionTimeoutMs: 10_000,
        });
        subsRef.current.push(sub);
      }
    };

    void attach();
    return () => {
      cancelled = true;
      brandsAbort?.abort();
      leaveSubs();
    };
  }, [brandFilter, loadList, maybeStopListPolling, onPresencePayload, startListPolling]);

  useEffect(() => {
    if (!dmTarget) {
      setDmReplies([]);
      return;
    }
    const ac = new AbortController();
    void fetchSavedReplies({ brand_id: dmTarget.brand_id, composer: true }, { signal: ac.signal })
      .then(setDmReplies)
      .catch((e) => {
        if (!isAbortError(e)) setDmReplies([]);
      });
    return () => ac.abort();
  }, [dmTarget?.brand_id, dmTarget?.visitor_id]);

  const sendDm = async () => {
    if (!dmTarget || !dmDraft.trim() || dmSending) return;
    const text = dmDraft.trim();
    const key = `visitor:${dmTarget.visitor_id}`;
    const pending = dmPendingRef.current.ensure(key, text, "agent", newClientMessageId);
    setDmSending(true);
    setDmError(null);
    setDmDraft("");
    try {
      await postLiveVisitorMessage(dmTarget.visitor_id, pending.clientMessageId, text, {
        page: dmTarget.page,
      });
      dmPendingRef.current.confirm(key, pending.clientMessageId);
    } catch (e) {
      dmPendingRef.current.markFailed(key, pending.clientMessageId);
      setDmDraft(text);
      setDmError(e instanceof ApiError ? e.message : "Could not send message");
    } finally {
      setDmSending(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Live Visitors"
        desc={`${rows.length} visitor${rows.length === 1 ? "" : "s"} online now`}
      />
      <VisitorArrivalControls />
      <p className="mb-2 text-xs text-muted-foreground" role="status">{realtimeStatusLabel(realtime)}</p>
      {error && (
        <div className="mb-3 flex items-center gap-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
          <span className="flex-1">{error}</span>
          <Btn variant="outline" type="button" onClick={() => void loadList({ mergeLive: true })}>Retry</Btn>
        </div>
      )}
      {loading && rows.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">Loading live visitors…</Card>
      ) : (
        <Table
          head={["Visitor", "Brand", "Current page", "First seen", "Last seen", "Status", "Chat", ""]}
          rows={rows.map((v) => [
            <span key="l" className="font-medium">{v.label}</span>,
            v.brand_name ?? `Brand #${v.brand_id}`,
            <code key="p" className="text-xs">{v.page}</code>,
            formatPresenceTime(v.first_seen_at),
            <span key="ls" title={formatTimeOnSite(v.first_seen_at, v.last_seen_at)}>
              {formatPresenceTime(v.last_seen_at)}
            </span>,
            <Badge key="s" tone={v.status === "active" ? "success" : "warning"}>{v.status}</Badge>,
            v.chat_opened ? <Badge key="c" tone="primary">Open</Badge> : <span key="c" className="text-xs text-muted-foreground">Closed</span>,
            <Btn
              key="a"
              variant="outline"
              type="button"
              onClick={() => {
                setDmTarget(v);
                setDmDraft("");
                setDmError(null);
              }}
            >
              Message
            </Btn>,
          ])}
        />
      )}
      {!loading && rows.length === 0 && !error && (
        <p className="mt-3 text-sm text-muted-foreground">No visitors are online for the selected brands.</p>
      )}

      {dmTarget && (
        <div className="mt-4 max-w-3xl" data-testid="agent-dm-composer">
          <AgentComposer
            title={dmTarget.label}
            subtitle={`${dmTarget.brand_name ?? `Brand #${dmTarget.brand_id}`} · ${dmTarget.page}`}
            onClose={() => setDmTarget(null)}
            value={dmDraft}
            onChange={setDmDraft}
            onSend={() => void sendDm()}
            replies={dmReplies}
            sending={dmSending}
            error={dmError}
          />
        </div>
      )}
    </>
  );
}
