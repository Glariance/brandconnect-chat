<?php

namespace App\Policies;

use App\Enums\Role;
use App\Models\SavedReply;
use App\Models\User;

class SavedReplyPolicy
{
    public function viewAny(User $user): bool
    {
        return $user->primaryMembership()->exists();
    }

    public function view(User $user, SavedReply $reply): bool
    {
        return $this->sameOrganization($user, $reply);
    }

    public function create(User $user): bool
    {
        return $this->managesOrganization($user);
    }

    public function update(User $user, SavedReply $reply): bool
    {
        return $this->managesOrganization($user) && $this->sameOrganization($user, $reply);
    }

    public function delete(User $user, SavedReply $reply): bool
    {
        return $this->update($user, $reply);
    }

    protected function sameOrganization(User $user, SavedReply $reply): bool
    {
        return $user->memberships()
            ->where('organization_id', $reply->organization_id)
            ->exists();
    }

    protected function managesOrganization(User $user): bool
    {
        $membership = $user->primaryMembership;

        return $membership !== null && $membership->role->managesOrganization();
    }
}
