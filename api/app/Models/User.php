<?php

namespace App\Models;

// use Illuminate\Contracts\Auth\MustVerifyEmail;
use App\Enums\Role;
use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;

#[Fillable(['name', 'email', 'password'])]
#[Hidden(['password', 'remember_token'])]
class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasFactory, Notifiable;

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
        ];
    }

    /**
     * @return HasMany<Membership, $this>
     */
    public function memberships(): HasMany
    {
        return $this->hasMany(Membership::class);
    }

    /**
     * The membership used as the dashboard's current organization.
     *
     * @return HasOne<Membership, $this>
     */
    public function primaryMembership(): HasOne
    {
        return $this->hasOne(Membership::class)->oldestOfMany();
    }

    /**
     * Brands this user has been explicitly assigned to as an agent.
     *
     * @return BelongsToMany<Brand, $this>
     */
    public function assignedBrands(): BelongsToMany
    {
        return $this->belongsToMany(Brand::class)->withTimestamps();
    }

    /**
     * Brands visible to this user: every brand of organizations they manage,
     * plus brands they are assigned to within organizations they belong to.
     *
     * @return Builder<Brand>
     */
    public function accessibleBrands(): Builder
    {
        $managedOrganizationIds = $this->memberships()
            ->whereIn('role', [Role::Owner->value, Role::Admin->value])
            ->select('organization_id');

        $memberOrganizationIds = $this->memberships()->select('organization_id');

        $assignedBrandIds = $this->assignedBrands()->select('brands.id');

        return Brand::query()->where(function (Builder $query) use ($managedOrganizationIds, $memberOrganizationIds, $assignedBrandIds) {
            $query->whereIn('organization_id', $managedOrganizationIds)
                ->orWhere(function (Builder $query) use ($memberOrganizationIds, $assignedBrandIds) {
                    $query->whereIn('organization_id', $memberOrganizationIds)
                        ->whereIn('id', $assignedBrandIds);
                });
        });
    }

    public function canAccessBrand(Brand $brand): bool
    {
        return $this->accessibleBrands()->whereKey($brand->getKey())->exists();
    }

    public function roleIn(Organization $organization): ?Role
    {
        return $this->memberships()
            ->where('organization_id', $organization->getKey())
            ->first()
            ?->role;
    }
}
