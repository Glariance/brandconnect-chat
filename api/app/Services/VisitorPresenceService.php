<?php

namespace App\Services;

use App\Events\VisitorPresenceUpdated;
use App\Models\Visitor;
use App\Models\VisitorPresence;
use App\Support\PagePath;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;

class VisitorPresenceService
{
    /**
     * Upsert a per-tab heartbeat and broadcast the aggregated visitor summary.
     *
     * @param  array{tab_id: string, page?: string|null, chat_opened?: bool, activity?: bool}  $input
     * @return array{presence: VisitorPresence, appeared: bool, summary: array<string, mixed>}
     */
    public function heartbeat(Visitor $visitor, array $input): array
    {
        $now = now();
        $page = PagePath::sanitize($input['page'] ?? '/');
        $tabId = $input['tab_id'];
        $chatOpened = (bool) ($input['chat_opened'] ?? false);
        $activity = array_key_exists('activity', $input) ? (bool) $input['activity'] : true;

        $existing = VisitorPresence::query()
            ->where('visitor_id', $visitor->getKey())
            ->where('tab_id', $tabId)
            ->first();

        $hadOnlineTab = VisitorPresence::query()
            ->where('visitor_id', $visitor->getKey())
            ->online($now)
            ->exists();

        $appeared = ! $hadOnlineTab;

        $presence = VisitorPresence::query()->updateOrCreate(
            [
                'visitor_id' => $visitor->getKey(),
                'tab_id' => $tabId,
            ],
            [
                'brand_id' => $visitor->brand_id,
                'page' => $page,
                'first_seen_at' => $existing?->first_seen_at ?? $now,
                'last_seen_at' => $now,
                'last_activity_at' => $activity
                    ? $now
                    : ($existing?->last_activity_at ?? $now),
                'chat_opened' => $chatOpened,
            ],
        );

        $this->expireStaleForBrand((int) $visitor->brand_id, $now);

        $summary = $this->aggregateForVisitor((int) $visitor->getKey(), $now) ?? [];
        $reason = $appeared
            ? VisitorPresenceUpdated::REASON_APPEARED
            : VisitorPresenceUpdated::REASON_UPDATED;

        if ($summary !== []) {
            VisitorPresenceUpdated::dispatch(
                (int) $visitor->brand_id,
                $summary,
                $reason,
            );
        }

        return [
            'presence' => $presence,
            'appeared' => $appeared,
            'summary' => $summary,
        ];
    }

    /**
     * @return array<string, mixed>|null
     */
    public function aggregateForVisitor(int $visitorId, ?Carbon $now = null): ?array
    {
        $now ??= now();

        $tabs = VisitorPresence::query()
            ->with(['visitor', 'brand'])
            ->where('visitor_id', $visitorId)
            ->online($now)
            ->orderByDesc('last_seen_at')
            ->get();

        if ($tabs->isEmpty()) {
            return null;
        }

        return $this->summarizeTabs($tabs, $now);
    }

    /**
     * Online visitors for authorized brand IDs, aggregated one row per visitor.
     *
     * @param  Collection<int, int>|array<int, int>  $brandIds
     * @return Collection<int, array<string, mixed>>
     */
    public function listOnline(Collection|array $brandIds, ?Carbon $now = null): Collection
    {
        $now ??= now();
        $brandIds = collect($brandIds)->map(fn ($id) => (int) $id)->unique()->values();

        if ($brandIds->isEmpty()) {
            return collect();
        }

        $this->expireStaleForBrands($brandIds->all(), $now);

        $tabs = VisitorPresence::query()
            ->with(['visitor', 'brand'])
            ->whereIn('brand_id', $brandIds)
            ->online($now)
            ->orderByDesc('last_seen_at')
            ->get();

        return $tabs
            ->groupBy('visitor_id')
            ->map(fn (Collection $group) => $this->summarizeTabs($group, $now))
            ->values()
            ->sortByDesc(fn (array $row) => $row['last_seen_at'] ?? '')
            ->values();
    }

    /**
     * @param  array<int, int>  $brandIds
     */
    public function expireStaleForBrands(array $brandIds, ?Carbon $now = null): void
    {
        foreach ($brandIds as $brandId) {
            $this->expireStaleForBrand((int) $brandId, $now);
        }
    }

    /**
     * Broadcast offline for visitors that just crossed the offline threshold.
     * Does not rely on unload/pagehide. Dedupes broadcasts via short cache keys.
     */
    public function expireStaleForBrand(int $brandId, ?Carbon $now = null): void
    {
        $now ??= now();
        $offlineAfter = VisitorPresence::offlineAfterSeconds();
        $cutoff = $now->copy()->subSeconds($offlineAfter);
        // Recently expired window: crossed offline within ~one heartbeat + skew.
        $recentFloor = $cutoff->copy()->subSeconds(40);

        $visitorIds = VisitorPresence::query()
            ->where('brand_id', $brandId)
            ->whereBetween('last_seen_at', [$recentFloor, $cutoff])
            ->pluck('visitor_id')
            ->unique();

        foreach ($visitorIds as $visitorId) {
            $stillOnline = VisitorPresence::query()
                ->where('visitor_id', $visitorId)
                ->online($now)
                ->exists();

            if ($stillOnline) {
                continue;
            }

            $cacheKey = 'presence:offline-broadcast:'.$visitorId;
            if (! Cache::add($cacheKey, 1, $offlineAfter)) {
                continue;
            }

            $last = VisitorPresence::query()
                ->with(['visitor', 'brand'])
                ->where('visitor_id', $visitorId)
                ->orderByDesc('last_seen_at')
                ->first();

            if ($last === null) {
                continue;
            }

            VisitorPresenceUpdated::dispatch(
                $brandId,
                $this->summarizeTabs(collect([$last]), $now, forceOffline: true),
                VisitorPresenceUpdated::REASON_OFFLINE,
            );
        }
    }

    /**
     * @param  Collection<int, VisitorPresence>  $tabs
     * @return array<string, mixed>
     */
    protected function summarizeTabs(Collection $tabs, Carbon $now, bool $forceOffline = false): array
    {
        /** @var VisitorPresence $latest */
        $latest = $tabs->sortByDesc(fn (VisitorPresence $p) => $p->last_seen_at?->getTimestamp() ?? 0)->first();
        $visitor = $latest->visitor;
        $firstSeen = $tabs->min(fn (VisitorPresence $p) => $p->first_seen_at);
        $lastSeen = $tabs->max(fn (VisitorPresence $p) => $p->last_seen_at);
        $lastActivity = $tabs->max(fn (VisitorPresence $p) => $p->last_activity_at);
        $chatOpened = $tabs->contains(fn (VisitorPresence $p) => $p->chat_opened);

        $probe = new VisitorPresence([
            'last_seen_at' => $lastSeen,
            'last_activity_at' => $lastActivity,
        ]);
        $status = $forceOffline ? 'offline' : $probe->activityStatus($now);

        return [
            'visitor_id' => (int) $latest->visitor_id,
            'brand_id' => (int) $latest->brand_id,
            'brand_name' => $latest->brand?->name,
            'label' => $visitor?->displayName() ?? 'Visitor #'.$latest->visitor_id,
            'page' => $latest->page,
            'first_seen_at' => $firstSeen instanceof Carbon ? $firstSeen->toIso8601ZuluString() : null,
            'last_seen_at' => $lastSeen instanceof Carbon ? $lastSeen->toIso8601ZuluString() : null,
            'status' => $status,
            'chat_opened' => $chatOpened,
            'tab_count' => $forceOffline ? 0 : $tabs->count(),
            'version' => $lastSeen instanceof Carbon
                ? $lastSeen->toIso8601ZuluString()
                : $now->toIso8601ZuluString(),
        ];
    }
}
