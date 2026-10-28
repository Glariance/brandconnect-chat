<?php

namespace Tests\Feature;

use App\Enums\Role;
use App\Models\Brand;
use App\Models\Organization;
use App\Models\Visitor;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Broadcast;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * Brand inbox channels are dashboard-only and reuse BrandPolicy::view / canAccessBrand.
 */
class InboxChannelAuthorizationTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        config([
            'broadcasting.default' => 'reverb',
            'broadcasting.connections.reverb' => [
                'driver' => 'reverb',
                'key' => 'test-key',
                'secret' => 'test-secret',
                'app_id' => 'test-app',
                'options' => ['host' => '127.0.0.1', 'port' => 8081, 'scheme' => 'http', 'useTLS' => false],
            ],
        ]);

        Broadcast::forgetDrivers();

        require base_path('routes/channels.php');
    }

    public function test_assigned_agent_can_subscribe_to_brand_inbox(): void
    {
        $brand = Brand::factory()->create();
        $agent = $this->createAssignedAgent($brand);

        $this->actingAs($agent)
            ->authorizeInboxChannel('/broadcasting/auth', $brand->id)
            ->assertOk()
            ->assertJsonStructure(['auth']);
    }

    public function test_owner_can_subscribe_to_organization_brand_inbox(): void
    {
        $brand = Brand::factory()->create();
        $owner = $this->createMember($brand->organization, Role::Owner);

        $this->actingAs($owner)
            ->authorizeInboxChannel('/broadcasting/auth', $brand->id)
            ->assertOk();
    }

    public function test_unassigned_agent_same_organization_cannot_subscribe(): void
    {
        $brand = Brand::factory()->create();
        $agent = $this->createMember($brand->organization, Role::Agent);

        $this->actingAs($agent)
            ->authorizeInboxChannel('/broadcasting/auth', $brand->id)
            ->assertForbidden();
    }

    public function test_agent_of_another_organization_cannot_subscribe(): void
    {
        $brand = Brand::factory()->create();
        $outsider = $this->createMember(Organization::factory()->create(), Role::Owner);

        $this->actingAs($outsider)
            ->authorizeInboxChannel('/broadcasting/auth', $brand->id)
            ->assertForbidden();
    }

    public function test_guest_cannot_subscribe_to_brand_inbox(): void
    {
        $brand = Brand::factory()->create();

        $this->authorizeInboxChannel('/broadcasting/auth', $brand->id)->assertForbidden();
        $this->authorizeInboxChannel('/api/v1/widget/broadcasting/auth', $brand->id)->assertUnauthorized();
    }

    public function test_visitor_cannot_subscribe_to_brand_inbox(): void
    {
        $brand = Brand::factory()->create();
        $visitor = Visitor::factory()->for($brand)->create();

        $this->actingAsVisitor($visitor)
            ->authorizeInboxChannel('/api/v1/widget/broadcasting/auth', $brand->id)
            ->assertForbidden();

        $this->actingAsVisitor($visitor)
            ->authorizeInboxChannel('/broadcasting/auth', $brand->id)
            ->assertForbidden();
    }

    protected function authorizeInboxChannel(string $endpoint, int $brandId): TestResponse
    {
        return $this->postJson($endpoint, [
            'socket_id' => '1234.5678',
            'channel_name' => 'private-brands.'.$brandId.'.inbox',
        ]);
    }
}
