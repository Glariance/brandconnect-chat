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

class PresenceChannelAuthorizationTest extends TestCase
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

    public function test_assigned_agent_can_subscribe_to_presence(): void
    {
        $brand = Brand::factory()->create();
        $agent = $this->createAssignedAgent($brand);

        $this->actingAs($agent)
            ->authorizePresenceChannel('/broadcasting/auth', $brand->id)
            ->assertOk();
    }

    public function test_unassigned_agent_and_outsider_and_visitor_denied(): void
    {
        $brand = Brand::factory()->create();
        $unassigned = $this->createMember($brand->organization, Role::Agent);
        $outsider = $this->createMember(Organization::factory()->create(), Role::Owner);
        $visitor = Visitor::factory()->for($brand)->create();

        $this->actingAs($unassigned)
            ->authorizePresenceChannel('/broadcasting/auth', $brand->id)
            ->assertForbidden();

        $this->actingAs($outsider)
            ->authorizePresenceChannel('/broadcasting/auth', $brand->id)
            ->assertForbidden();

        $this->actingAsVisitor($visitor)
            ->authorizePresenceChannel('/api/v1/widget/broadcasting/auth', $brand->id)
            ->assertForbidden();

        $this->authorizePresenceChannel('/broadcasting/auth', $brand->id)->assertForbidden();
    }

    protected function authorizePresenceChannel(string $endpoint, int $brandId): TestResponse
    {
        return $this->postJson($endpoint, [
            'socket_id' => '1234.5678',
            'channel_name' => 'private-brands.'.$brandId.'.presence',
        ]);
    }
}
