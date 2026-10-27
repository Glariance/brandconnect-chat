<?php

namespace App\Policies;

use App\Models\Brand;
use App\Models\User;

class BrandPolicy
{
    /**
     * Any member can list brands; the query itself is scoped to accessible brands.
     */
    public function viewAny(User $user): bool
    {
        return $user->memberships()->exists();
    }

    public function view(User $user, Brand $brand): bool
    {
        return $user->canAccessBrand($brand);
    }

    /**
     * Only owners and admins of the user's primary organization can create brands there.
     */
    public function create(User $user): bool
    {
        return (bool) $user->primaryMembership?->role->managesOrganization();
    }

    public function update(User $user, Brand $brand): bool
    {
        return (bool) $user->roleIn($brand->organization)?->managesOrganization();
    }
}
