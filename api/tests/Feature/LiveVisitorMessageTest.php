<?php

namespace Tests\Feature;

use App\Enums\ConversationStatus;
use App\Enums\SenderType;
use App\Models\Brand;
use App\Models\Conversation;
use App\Models\Message;
use App\Models\Visitor;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class LiveVisitorMessageTest extends TestCase
{
    use RefreshDatabase;

    public function test_assigned_agent_can_dm_an_online_visitor(): void
    {
        $brand = Brand::factory()->create();
        $agent = $this->createAssignedAgent($brand);
        $visitor = Visitor::factory()->for($brand)->create();
        $clientMessageId = (string) Str::uuid();

        $this->actingAs($agent)
            ->postJson("/api/v1/live-visitors/{$visitor->id}/messages", [
                'client_message_id' => $clientMessageId,
                'text' => 'Hi, need a hand?',
                'page' => '/pricing?utm=1',
            ])
            ->assertCreated()
            ->assertJsonPath('data.message.body', 'Hi, need a hand?')
            ->assertJsonPath('data.message.sender_type', 'agent')
            ->assertJsonPath('data.message.client_message_id', $clientMessageId)
            ->assertJsonPath('data.conversation.id', Conversation::query()->sole()->id);

        $conversation = Conversation::query()->sole();
        $this->assertSame($visitor->id, $conversation->visitor_id);
        $this->assertSame($brand->id, $conversation->brand_id);
        $this->assertSame(ConversationStatus::Open, $conversation->status);

        $message = Message::query()->sole();
        $this->assertSame($conversation->id, $message->conversation_id);
        $this->assertSame(SenderType::Agent, $message->sender_type);
        $this->assertSame($agent->id, $message->sender_user_id);
    }

    public function test_duplicate_client_message_id_is_idempotent(): void
    {
        $brand = Brand::factory()->create();
        $agent = $this->createAssignedAgent($brand);
        $visitor = Visitor::factory()->for($brand)->create();
        $clientMessageId = (string) Str::uuid();
        $url = "/api/v1/live-visitors/{$visitor->id}/messages";

        $this->actingAs($agent);

        $firstId = $this->postJson($url, ['client_message_id' => $clientMessageId, 'text' => 'Hello'])
            ->assertCreated()
            ->json('data.message.id');

        $this->postJson($url, ['client_message_id' => $clientMessageId, 'text' => 'Hello'])
            ->assertOk()
            ->assertJsonPath('data.message.id', $firstId);

        $this->assertSame(1, Message::query()->count());
        $this->assertSame(1, Conversation::query()->count());
    }

    public function test_agent_without_brand_access_is_forbidden(): void
    {
        $brand = Brand::factory()->create();
        $otherBrand = Brand::factory()->for($brand->organization)->create();
        $agent = $this->createAssignedAgent($otherBrand);
        $visitor = Visitor::factory()->for($brand)->create();

        $this->actingAs($agent)
            ->postJson("/api/v1/live-visitors/{$visitor->id}/messages", [
                'client_message_id' => (string) Str::uuid(),
                'text' => 'Hello',
            ])
            ->assertForbidden();

        $this->assertDatabaseCount('conversations', 0);
        $this->assertDatabaseCount('messages', 0);
    }

    public function test_second_message_reuses_the_open_conversation(): void
    {
        $brand = Brand::factory()->create();
        $agent = $this->createAssignedAgent($brand);
        $visitor = Visitor::factory()->for($brand)->create();
        $url = "/api/v1/live-visitors/{$visitor->id}/messages";

        $this->actingAs($agent);

        $conversationId = $this->postJson($url, ['client_message_id' => (string) Str::uuid(), 'text' => 'First'])
            ->assertCreated()
            ->json('data.conversation.id');

        $this->postJson($url, ['client_message_id' => (string) Str::uuid(), 'text' => 'Second'])
            ->assertCreated()
            ->assertJsonPath('data.conversation.id', $conversationId);

        $this->assertSame(1, Conversation::query()->count());
        $this->assertSame(2, Message::query()->where('conversation_id', $conversationId)->count());
    }

    public function test_closed_conversation_is_not_reused(): void
    {
        $brand = Brand::factory()->create();
        $agent = $this->createAssignedAgent($brand);
        $visitor = Visitor::factory()->for($brand)->create();
        $closed = Conversation::factory()->forVisitor($visitor)->closed()->create();

        $this->actingAs($agent)
            ->postJson("/api/v1/live-visitors/{$visitor->id}/messages", [
                'client_message_id' => (string) Str::uuid(),
                'text' => 'Fresh start',
            ])
            ->assertCreated()
            ->assertJsonPath('data.conversation.id', Conversation::query()->whereKeyNot($closed->id)->sole()->id);
    }

    public function test_visitor_presence_heartbeat_includes_open_conversation_id_after_agent_dm(): void
    {
        $brand = Brand::factory()->create();
        $agent = $this->createAssignedAgent($brand);
        $visitor = Visitor::factory()->for($brand)->create();
        $tabId = (string) Str::uuid();

        $this->actingAsVisitor($visitor)
            ->postJson('/api/v1/widget/presence', ['tab_id' => $tabId, 'page' => '/'])
            ->assertCreated()
            ->assertJsonPath('data.open_conversation_id', null);

        // Switch from visitor bearer credentials back to a session-style agent.
        $this->withoutToken();
        $this->app['auth']->forgetGuards();
        $this->app['auth']->shouldUse('web');

        $conversationId = $this->actingAs($agent, 'web')
            ->postJson("/api/v1/live-visitors/{$visitor->id}/messages", [
                'client_message_id' => (string) Str::uuid(),
                'text' => 'Hello there',
            ])
            ->assertCreated()
            ->json('data.conversation.id');

        $this->actingAsVisitor($visitor)
            ->postJson('/api/v1/widget/presence', ['tab_id' => $tabId, 'page' => '/'])
            ->assertOk()
            ->assertJsonPath('data.open_conversation_id', $conversationId);
    }
}
