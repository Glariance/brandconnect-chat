import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { PageHeader, Badge, Btn, Card, Table } from "@/components/app-shell";
import { visitors as sampleVisitors } from "@/lib/sample-data";
import { ApiError, isAbortError, isRealChatEnabled } from "@/lib/api";
import { fetchBrands, fetchLiveVisitors, type ApiLiveVisitor } from "@/lib/chat-api";
import { parseBrandFilterId, useBrandFilter } from "@/lib/brand-filter";
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
            <Btn variant="outline">Invite to chat</Btn>
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

  const loadList = useCallback(async (opts?: { mergeLive?: boolean }) => {
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
      setRows((prev) => (opts?.mergeLive ? mergePresenceLists(http, prev, filters) : mergePresenceLists(http, [], filters)));
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
  }, []);

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
    // Mark live as soon as every brand channel is subscribed; keep HTTP polling
    // until the authoritative list reconcile finishes.
    setRealtime((s) => (s === "polling" || s === "connecting" ? "live" : s));
    if (reconciledRef.current) stopListPolling();
  }, [stopListPolling]);

  const onPresencePayload = useCallback((payload: unknown) => {
    const parsed = liveVisitorFromBroadcast(payload);
    if (!parsed) return;
    setRows((prev) => applyPresenceUpdate(prev, parsed.visitor, parsed.reason, filtersRef.current));
  }, []);

  useEffect(() => {
    setLoading(true);
    reconciledRef.current = false;
    void loadList({ mergeLive: false }).then((ok) => {
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
          releaseAgentEcho();
          return;
        }
        echoRef.current = echo;
        echoReadyRef.current = true;
        setRealtime(echo ? "connecting" : "polling");
        if (!echo) startListPolling();
      })
      .catch(() => {
        if (cancelled) return;
        echoRef.current = null;
        echoReadyRef.current = true;
        setRealtime("polling");
        startListPolling();
      });
    return () => {
      cancelled = true;
      stopListPolling();
      for (const sub of subsRef.current) sub.leave();
      subsRef.current = [];
      subscribedBrandIdsRef.current.clear();
      releaseAgentEcho();
      echoRef.current = null;
      echoReadyRef.current = false;
    };
  }, [startListPolling, stopListPolling]);

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
                // Keep other brand sockets; only poll while reconcile is unhealthy.
                startListPolling();
              }
            })();
          },
          onSubscriptionError: () => {
            // One brand auth failure must not drop healthy sibling subscriptions.
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

  return (
    <>
      <PageHeader
        title="Live Visitors"
        desc={`${rows.length} visitor${rows.length === 1 ? "" : "s"} online now`}
      />
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
              disabled
              title="Invite to chat is not available until end-to-end delivery is implemented."
            >
              Invite to chat
            </Btn>,
          ])}
        />
      )}
      {!loading && rows.length === 0 && !error && (
        <p className="mt-3 text-sm text-muted-foreground">No visitors are online for the selected brands.</p>
      )}
    </>
  );
}
