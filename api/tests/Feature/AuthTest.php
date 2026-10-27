<?php

namespace Tests\Feature;

use App\Enums\Role;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AuthTest extends TestCase
{
    use RefreshDatabase;

    /**
     * @var array<string, string>
     */
    protected array $spaHeaders = [
        'Origin' => 'http://localhost:3000',
        'Referer' => 'http://localhost:3000/login',
    ];

    public function test_owner_can_log_in_from_the_spa_and_fetch_current_user(): void
    {
        $organization = Organization::factory()->create(['name' => 'Acme']);
        $user = $this->createMember($organization, Role::Owner);

        $this->withHeaders($this->spaHeaders)
            ->postJson('/api/v1/auth/login', ['email' => $user->email, 'password' => 'password'])
            ->assertOk()
            ->assertJsonPath('data.id', $user->id)
            ->assertJsonPath('data.role', 'owner')
            ->assertJsonPath('data.organization.name', 'Acme')
            ->assertJsonMissingPath('data.password');

        $this->assertAuthenticatedAs($user, 'web');

        $this->withHeaders($this->spaHeaders)
            ->getJson('/api/v1/auth/me')
            ->assertOk()
            ->assertJsonPath('data.email', $user->email);
    }

    public function test_login_rejects_invalid_credentials(): void
    {
        $user = User::factory()->create();

        $this->withHeaders($this->spaHeaders)
            ->postJson('/api/v1/auth/login', ['email' => $user->email, 'password' => 'wrong-password'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('email');

        $this->assertGuest('web');
    }

    public function test_login_requires_a_stateful_first_party_origin(): void
    {
        $user = User::factory()->create();

        $this->postJson('/api/v1/auth/login', ['email' => $user->email, 'password' => 'password'])
            ->assertBadRequest();

        $this->assertGuest('web');
    }

    public function test_login_is_rate_limited(): void
    {
        $user = User::factory()->create();

        for ($attempt = 0; $attempt < 5; $attempt++) {
            $this->withHeaders($this->spaHeaders)
                ->postJson('/api/v1/auth/login', ['email' => $user->email, 'password' => 'wrong-password'])
                ->assertUnprocessable();
        }

        $this->withHeaders($this->spaHeaders)
            ->postJson('/api/v1/auth/login', ['email' => $user->email, 'password' => 'password'])
            ->assertTooManyRequests();
    }

    public function test_logout_ends_the_session(): void
    {
        $user = $this->createMember(Organization::factory()->create());

        $this->withHeaders($this->spaHeaders)
            ->postJson('/api/v1/auth/login', ['email' => $user->email, 'password' => 'password'])
            ->assertOk();

        $this->withHeaders($this->spaHeaders)
            ->postJson('/api/v1/auth/logout')
            ->assertNoContent();

        $this->assertGuest('web');

        $this->app['auth']->forgetGuards();

        $this->withHeaders($this->spaHeaders)
            ->getJson('/api/v1/auth/me')
            ->assertUnauthorized();
    }

    public function test_guests_are_blocked_from_dashboard_endpoints(): void
    {
        $this->getJson('/api/v1/auth/me')->assertUnauthorized();
        $this->getJson('/api/v1/brands')->assertUnauthorized();
        $this->postJson('/api/v1/brands', ['name' => 'X'])->assertUnauthorized();
        $this->getJson('/api/v1/conversations')->assertUnauthorized();
        $this->getJson('/api/v1/conversations/01890000-0000-7000-8000-000000000000/messages')->assertUnauthorized();
        $this->patchJson('/api/v1/conversations/01890000-0000-7000-8000-000000000000', ['status' => 'closed'])->assertUnauthorized();
    }
}
