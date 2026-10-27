<?php

namespace Tests\Feature;

use App\Enums\Role;
use App\Models\Brand;
use App\Models\Conversation;
use App\Models\Organization;
use App\Models\Visitor;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Broadcast;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * Uses a real (offline) Reverb broadcaster so channel callbacks actually run;
 * the null broadcaster used elsewhere in tests authorizes nothing.
 */
class ChannelAuthorizationTest extends TestCase
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

    public function test_agent_with_brand_access_can_subscribe(): void
    {
        $brand = Brand::factory()->create();
        $agent = $this->createAssignedAgent($brand);
        $conversation = Conversation::factory()->for($brand)->create();

        $this->actingAs($agent)
            ->authorizeChannel('/broadcasting/auth', $conversation->id)
            ->assertOk()
            ->assertJsonStructure(['auth']);
    }

    public function test_agent_of_another_organization_cannot_subscribe(): void
    {
        $owner = $this->createMember(Organization::factory()->create(), Role::Owner);
        $conversation = Conversation::factory()->create();

        $this->actingAs($owner)
            ->authorizeChannel('/broadcasting/auth', $conversation->id)
            ->assertForbidden();
    }

    public function test_guest_cannot_subscribe(): void
    {
        $conversation = Conversation::factory()->create();

        $this->authorizeChannel('/broadcasting/auth', $conversation->id)->assertForbidden();
        $this->authorizeChannel('/api/v1/widget/broadcasting/auth', $conversation->id)->assertUnauthorized();
    }

    public function test_visitor_can_subscribe_only_to_their_own_conversation(): void
    {
        $brand = Brand::factory()->create();
        $visitor = Visitor::factory()->for($brand)->create();
        $otherVisitor = Visitor::factory()->for($brand)->create();
        $ownConversation = Conversation::factory()->forVisitor($visitor)->create();
        $otherConversation = Conversation::factory()->forVisitor($otherVisitor)->create();

        $this->actingAsVisitor($visitor);

        $this->authorizeChannel('/api/v1/widget/broadcasting/auth', $ownConversation->id)
            ->assertOk()
            ->assertJsonStructure(['auth']);

        $this->authorizeChannel('/api/v1/widget/broadcasting/auth', $otherConversation->id)->assertForbidden();
        $this->authorizeChannel('/api/v1/widget/broadcasting/auth', '01890000-0000-7000-8000-000000000000')->assertForbidden();
    }

    protected function authorizeChannel(string $endpoint, string $conversationId): TestResponse
    {
        return $this->postJson($endpoint, [
            'socket_id' => '1234.5678',
            'channel_name' => 'private-conversations.'.$conversationId,
        ]);
    }
}
