<?php

namespace Tests;

use App\Enums\Role;
use App\Models\Brand;
use App\Models\Membership;
use App\Models\Organization;
use App\Models\User;
use App\Models\Visitor;
use App\Models\VisitorSession;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;

abstract class TestCase extends BaseTestCase
{
    /**
     * Create a user with a membership of the given role in the organization.
     */
    protected function createMember(Organization $organization, Role $role = Role::Owner): User
    {
        $user = User::factory()->create();

        Membership::factory()->create([
            'organization_id' => $organization->getKey(),
            'user_id' => $user->getKey(),
            'role' => $role,
        ]);

        return $user;
    }

    /**
     * Create an agent explicitly assigned to the given brand.
     */
    protected function createAssignedAgent(Brand $brand): User
    {
        $agent = $this->createMember($brand->organization, Role::Agent);
        $brand->agents()->attach($agent);

        return $agent;
    }

    /**
     * Authenticate subsequent requests as the visitor via a fresh bearer token.
     */
    protected function actingAsVisitor(Visitor $visitor): static
    {
        return $this->withVisitorToken(VisitorSession::issueFor($visitor)->plainTextToken);
    }

    /**
     * Guards cache the resolved user per application instance, so they are
     * reset whenever the test switches credentials.
     */
    protected function withVisitorToken(string $token): static
    {
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }
}
