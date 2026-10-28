<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

class VisitorPresence extends Model
{
    protected $fillable = [
        'visitor_id',
        'brand_id',
        'tab_id',
        'page',
        'first_seen_at',
        'last_seen_at',
        'last_activity_at',
        'chat_opened',
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'first_seen_at' => 'datetime',
            'last_seen_at' => 'datetime',
            'last_activity_at' => 'datetime',
            'chat_opened' => 'boolean',
        ];
    }

    /**
     * @return BelongsTo<Visitor, $this>
     */
    public function visitor(): BelongsTo
    {
        return $this->belongsTo(Visitor::class);
    }

    /**
     * @return BelongsTo<Brand, $this>
     */
    public function brand(): BelongsTo
    {
        return $this->belongsTo(Brand::class);
    }

    public static function offlineAfterSeconds(): int
    {
        return (int) config('brandconnect.presence.offline_after_seconds', 90);
    }

    public static function activeWithinSeconds(): int
    {
        return (int) config('brandconnect.presence.active_within_seconds', 60);
    }

    public function scopeOnline(Builder $query, ?Carbon $now = null): Builder
    {
        $now ??= now();

        return $query->where('last_seen_at', '>=', $now->copy()->subSeconds(self::offlineAfterSeconds()));
    }

    public function isOnline(?Carbon $now = null): bool
    {
        $now ??= now();

        return $this->last_seen_at !== null
            && $this->last_seen_at->gte($now->copy()->subSeconds(self::offlineAfterSeconds()));
    }

    /**
     * Active = online and recent visible activity; idle = online without recent activity.
     */
    public function activityStatus(?Carbon $now = null): string
    {
        $now ??= now();
        if (! $this->isOnline($now)) {
            return 'offline';
        }

        if ($this->last_activity_at !== null
            && $this->last_activity_at->gte($now->copy()->subSeconds(self::activeWithinSeconds()))) {
            return 'active';
        }

        return 'idle';
    }
}
