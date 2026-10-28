<?php

namespace Tests\Feature;

use App\Enums\ConversationStatus;
use App\Events\InboxConversationUpdated;
use App\Events\MessageCreated;
use App\Models\Brand;
use App\Models\Conversation;
use App\Models\Visitor;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Str;
use Tests\TestCase;

class InboxConversationUpdatedTest extends TestCase
{
    use RefreshDatabase;

    public function test_new_visitor_conversation_dispatches_inbox_created_event(): void
    {
        Event::fake([InboxConversationUpdated::class]);

        $visitor = Visitor::factory()->create();

        $this->actingAsVisitor($visitor)
            ->postJson('/api/v1/widget/conversations', ['page' => '/pricing'])
            ->assertCreated();

        Event::assertDispatched(InboxConversationUpdated::class, function (InboxConversationUpdated $event) use ($visitor): bool {
            $channels = $event->broadcastOn();
            $payload = $event->broadcastWith();

            return $event->reason === InboxConversationUpdated::REASON_CREATED
                && count($channels) === 1
                && $channels[0]->name === 'private-brands.'.$visitor->brand_id.'.inbox'
                && $event->broadcastAs() === 'inbox.conversation.updated'
                && $payload['conversation']['brand_id'] === (int) $visitor->brand_id
                && $payload['conversation']['status'] === ConversationStatus::Open->value
                && isset($payload['conversation']['version'])
                && ! array_key_exists('unread_count', $payload['conversation'])
                && ! array_key_exists('visitor_id', $payload['conversation']);
        });
    }

    public function test_resuming_open_conversation_does_not_redispatch_created(): void
    {
        Event::fake([InboxConversationUpdated::class]);

        $visitor = Visitor::factory()->create();
        Conversation::factory()->forVisitor($visitor)->create();

        $this->actingAsVisitor($visitor)
            ->postJson('/api/v1/widget/conversations', ['page' => '/pricing'])
            ->assertOk();

        Event::assertNotDispatched(InboxConversationUpdated::class);
    }

    public function test_new_message_dispatches_inbox_summary_once_and_duplicate_retry_does_not(): void
    {
        Event::fake([InboxConversationUpdated::class, MessageCreated::class]);

        $visitor = Visitor::factory()->create();
        $conversation = Conversation::factory()->forVisitor($visitor)->create();
        $clientMessageId = (string) Str::uuid();

        $this->actingAsVisitor($visitor);

        $this->postJson("/api/v1/widget/conversations/{$conversation->id}/messages", [
            'client_message_id' => $clientMessageId,
            'text' => 'Hello inbox',
        ])->assertCreated();

        $this->postJson("/api/v1/widget/conversations/{$conversation->id}/messages", [
            'client_message_id' => Str::upper($clientMessageId),
            'text' => 'Hello inbox',
        ])->assertOk();

        Event::assertDispatchedTimes(MessageCreated::class, 1);
        Event::assertDispatchedTimes(InboxConversationUpdated::class, 1);
        Event::assertDispatched(InboxConversationUpdated::class, function (InboxConversationUpdated $event) use ($conversation): bool {
            $payload = $event->broadcastWith();

            return $event->reason === InboxConversationUpdated::REASON_MESSAGE
                && $payload['conversation']['id'] === $conversation->id
                && $payload['conversation']['last_message_preview'] === 'Hello inbox';
        });
    }

    public function test_status_change_dispatches_inbox_status_event(): void
    {
        Event::fake([InboxConversationUpdated::class]);

        $brand = Brand::factory()->create();
        $agent = $this->createAssignedAgent($brand);
        $conversation = Conversation::factory()->for($brand)->create();

        $this->actingAs($agent)
            ->patchJson("/api/v1/conversations/{$conversation->id}", ['status' => 'closed'])
            ->assertOk();

        Event::assertDispatched(InboxConversationUpdated::class, function (InboxConversationUpdated $event) use ($conversation): bool {
            return $event->reason === InboxConversationUpdated::REASON_STATUS
                && $event->broadcastWith()['conversation']['status'] === 'closed'
                && $event->broadcastWith()['conversation']['id'] === $conversation->id;
        });
    }

    public function test_inbox_payload_excludes_tokens_and_uses_safe_visitor_name(): void
    {
        $visitor = Visitor::factory()->create(['name' => 'Pat Visitor']);
        $conversation = Conversation::factory()->forVisitor($visitor)->create([
            'last_message_preview' => 'Hi',
            'last_message_at' => now(),
        ]);

        $event = new InboxConversationUpdated($conversation->fresh(['visitor']), InboxConversationUpdated::REASON_CREATED);
        $payload = $event->broadcastWith();

        $this->assertSame('Pat Visitor', $payload['conversation']['visitor_name']);
        $this->assertArrayNotHasKey('token', $payload);
        $this->assertArrayNotHasKey('unread_count', $payload['conversation']);
        $this->assertArrayHasKey('version', $payload['conversation']);
    }
}
