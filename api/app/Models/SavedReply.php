<?php

namespace App\Models;

use App\Support\SavedReplyShortcut;
use Database\Factories\SavedReplyFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'organization_id',
    'brand_id',
    'scope_key',
    'created_by',
    'title',
    'shortcut',
    'body',
    'is_active',
    'archived_at',
])]
class SavedReply extends Model
{
    /** @use HasFactory<SavedReplyFactory> */
    use HasFactory;

    /** Soft archive uses archived_at so unique shortcuts can be reused after archive. */

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'is_active' => 'boolean',
            'archived_at' => 'datetime',
        ];
    }

    /**
     * @return BelongsTo<Organization, $this>
     */
    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    /**
     * @return BelongsTo<Brand, $this>
     */
    public function brand(): BelongsTo
    {
        return $this->belongsTo(Brand::class);
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function isOrgWide(): bool
    {
        return $this->brand_id === null;
    }

    public function isArchived(): bool
    {
        return $this->archived_at !== null;
    }

    /**
     * @param  Builder<self>  $query
     * @return Builder<self>
     */
    public function scopeNotArchived(Builder $query): Builder
    {
        return $query->whereNull('archived_at');
    }

    /**
     * Active replies for a brand: org-wide defaults overridden by brand-specific shortcuts.
     *
     * @param  Builder<self>  $query
     * @return Builder<self>
     */
    public function scopeForComposerBrand(Builder $query, Organization $organization, Brand $brand): Builder
    {
        return $query
            ->where('organization_id', $organization->getKey())
            ->whereNull('archived_at')
            ->where('is_active', true)
            ->where(function (Builder $q) use ($brand): void {
                $q->whereNull('brand_id')->orWhere('brand_id', $brand->getKey());
            });
    }

    /**
     * Deterministic merge: brand-specific shortcut wins over organization default.
     *
     * @param  iterable<SavedReply>  $replies
     * @return list<SavedReply>
     */
    public static function resolveConflicts(iterable $replies): array
    {
        /** @var array<string, SavedReply> $byShortcut */
        $byShortcut = [];

        foreach ($replies as $reply) {
            $key = $reply->shortcut;
            $existing = $byShortcut[$key] ?? null;
            if ($existing === null) {
                $byShortcut[$key] = $reply;
                continue;
            }
            // Brand-specific overrides org-wide.
            if ($existing->isOrgWide() && ! $reply->isOrgWide()) {
                $byShortcut[$key] = $reply;
            }
        }

        $resolved = array_values($byShortcut);
        usort($resolved, fn (SavedReply $a, SavedReply $b): int => strcmp($a->shortcut, $b->shortcut));

        return $resolved;
    }

    public static function makeScopeKey(?int $brandId): string
    {
        return SavedReplyShortcut::scopeKey($brandId);
    }
}
