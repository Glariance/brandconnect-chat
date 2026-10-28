<?php

namespace Tests\Feature;

use App\Enums\ConversationStatus;
use App\Enums\SenderType;
use App\Events\InboxConversationUpdated;
use App\Events\MessageCreated;
use App\Models\Brand;
use App\Models\Conversation;
use App\Models\Message;
use App\Models\Visitor;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Str;
use Tests\TestCase;

class MessageTest extends TestCase
{
    use RefreshDatabase;

    public function test_visitor_cannot_spoof_agent_or_bot_sender_identity(): void
    {
        $brand = Brand::factory()->create();
        $agent = $this->createAssignedAgent($brand);
        $visitor = Visitor::factory()->for($brand)->create();
        $conversation = Conversation::factory()->forVisitor($visitor)->create();

        $this->actingAsVisitor($visitor)
            ->postJson("/api/v1/widget/conversations/{$conversation->id}/messages", [
                'client_message_id' => (string) Str::uuid(),
                'text' => 'I am totally the agent',
                'sender_type' => 'agent',
                'sender_user_id' => $agent->id,
                'sender_visitor_id' => 999,
            ])
            ->assertCreated()
            ->assertJsonPath('data.sender_type', 'visitor');

        $message = Message::query()->sole();
        $this->assertSame(SenderType::Visitor, $message->sender_type);
        $this->assertNull($message->sender_user_id);
        $this->assertSame($visitor->id, $message->sender_visitor_id);
    }

    public function test_agent_messages_are_attributed_to_the_authenticated_agent(): void
    {
        $brand = Brand::factory()->create();
        $agent = $this->createAssignedAgent($brand);
        $conversation = Conversation::factory()->for($brand)->create();

        $this->actingAs($agent)
            ->postJson("/api/v1/conversations/{$conversation->id}/messages", [
                'client_message_id' => (string) Str::uuid(),
                'text' => 'Hello from support',
                'sender_type' => 'bot',
            ])
            ->assertCreated()
            ->assertJsonPath('data.sender_type', 'agent')
            ->assertJsonPath('data.body', 'Hello from support');

        $message = Message::query()->sole();
        $this->assertSame($agent->id, $message->sender_user_id);
        $this->assertNull($message->sender_visitor_id);
        $this->assertSame('Hello from support', $conversation->fresh()->last_message_preview);
    }

    public function test_duplicate_client_message_id_retry_returns_the_original_message(): void
    {
        Event::fake([MessageCreated::class, InboxConversationUpdated::class]);

        $visitor = Visitor::factory()->create();
        $conversation = Conversation::factory()->forVisitor($visitor)->create();
        $clientMessageId = (string) Str::uuid();

        $this->actingAsVisitor($visitor);

        $firstId = $this->postJson("/api/v1/widget/conversations/{$conversation->id}/messages", [
            'client_message_id' => $clientMessageId,
            'text' => 'Hello',
        ])->assertCreated()->json('data.id');

        $this->postJson("/api/v1/widget/conversations/{$conversation->id}/messages", [
            'client_message_id' => Str::upper($clientMessageId),
            'text' => 'Hello',
        ])
            ->assertOk()
            ->assertJsonPath('data.id', $firstId)
            ->assertJsonPath('data.client_message_id', $clientMessageId);

        $this->assertSame(1, $conversation->messages()->count());
        Event::assertDispatchedTimes(MessageCreated::class, 1);
        Event::assertDispatchedTimes(InboxConversationUpdated::class, 1);
    }

    public function test_client_message_id_reused_by_a_different_sender_is_rejected(): void
    {
        $brand = Brand::factory()->create();
        $agent = $this->createAssignedAgent($brand);
        $visitor = Visitor::factory()->for($brand)->create();
        $conversation = Conversation::factory()->forVisitor($visitor)->create();
        $clientMessageId = (string) Str::uuid();

        $this->actingAs($agent)
            ->postJson("/api/v1/conversations/{$conversation->id}/messages", ['client_message_id' => $clientMessageId, 'text' => 'Agent'])
            ->assertCreated();

        $this->actingAsVisitor($visitor)
            ->postJson("/api/v1/widget/conversations/{$conversation->id}/messages", ['client_message_id' => $clientMessageId, 'text' => 'Visitor'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('client_message_id');

        $this->assertSame(1, $conversation->messages()->count());
    }

    public function test_same_client_message_id_may_be_used_in_different_conversations(): void
    {
        $visitor = Visitor::factory()->create();
        $first = Conversation::factory()->forVisitor($visitor)->create();
        $second = Conversation::factory()->forVisitor($visitor)->create();
        $clientMessageId = (string) Str::uuid();

        $this->actingAsVisitor($visitor);

        $this->postJson("/api/v1/widget/conversations/{$first->id}/messages", ['client_message_id' => $clientMessageId, 'text' => 'One'])->assertCreated();
        $this->postJson("/api/v1/widget/conversations/{$second->id}/messages", ['client_message_id' => $clientMessageId, 'text' => 'Two'])->assertCreated();
    }

    public function test_message_validation(): void
    {
        $visitor = Visitor::factory()->create();
        $conversation = Conversation::factory()->forVisitor($visitor)->create();
        $url = "/api/v1/widget/conversations/{$conversation->id}/messages";

        $this->actingAsVisitor($visitor);

        $this->postJson($url, ['text' => 'Missing id'])->assertUnprocessable()->assertJsonValidationErrors('client_message_id');
        $this->postJson($url, ['client_message_id' => 'not-a-uuid', 'text' => 'x'])->assertUnprocessable()->assertJsonValidationErrors('client_message_id');
        $this->postJson($url, ['client_message_id' => (string) Str::uuid(), 'text' => '   '])->assertUnprocessable()->assertJsonValidationErrors('text');
        $this->postJson($url, ['client_message_id' => (string) Str::uuid(), 'text' => str_repeat('a', 5001)])->assertUnprocessable()->assertJsonValidationErrors('text');
    }

    public function test_message_is_stored_before_broadcasting_on_the_private_conversation_channel(): void
    {
        Event::fake([MessageCreated::class]);

        $visitor = Visitor::factory()->create();
        $conversation = Conversation::factory()->forVisitor($visitor)->create();

        $this->actingAsVisitor($visitor)
            ->postJson("/api/v1/widget/conversations/{$conversation->id}/messages", [
                'client_message_id' => (string) Str::uuid(),
                'text' => '<script>alert(1)</script>',
            ])
            ->assertCreated()
            ->assertJsonPath('data.body', '<script>alert(1)</script>');

        Event::assertDispatched(MessageCreated::class, function (MessageCreated $event) use ($conversation): bool {
            $channels = $event->broadcastOn();
            $payload = $event->broadcastWith();

            return $event->message->exists
                && count($channels) === 1
                && $channels[0]->name === 'private-conversations.'.$conversation->id
                && $event->broadcastAs() === 'message.created'
                && array_keys($payload['message']) === ['id', 'conversation_id', 'client_message_id', 'sender_type', 'body', 'created_at'];
        });
    }

    public function test_visitor_reply_reopens_a_closed_conversation(): void
    {
        $visitor = Visitor::factory()->create();
        $conversation = Conversation::factory()->forVisitor($visitor)->closed()->create();

        $this->actingAsVisitor($visitor)
            ->postJson("/api/v1/widget/conversations/{$conversation->id}/messages", [
                'client_message_id' => (string) Str::uuid(),
                'text' => 'One more question',
            ])
            ->assertCreated();

        $this->assertSame(ConversationStatus::Open, $conversation->fresh()->status);
    }

    public function test_messages_can_be_fetched_after_a_given_id_for_reconnect(): void
    {
        $visitor = Visitor::factory()->create();
        $conversation = Conversation::factory()->forVisitor($visitor)->create();
        $messages = Message::factory()->for($conversation)->count(3)->create();

        $this->actingAsVisitor($visitor)
            ->getJson("/api/v1/widget/conversations/{$conversation->id}/messages?after_id={$messages[0]->id}")
            ->assertOk()
            ->assertJsonCount(2, 'data')
            ->assertJsonPath('data.0.id', $messages[1]->id)
            ->assertJsonPath('data.1.id', $messages[2]->id);

        $this->getJson("/api/v1/widget/conversations/{$conversation->id}/messages")
            ->assertOk()
            ->assertJsonCount(3, 'data')
            ->assertJsonPath('data.0.id', $messages[0]->id)
            ->assertJsonPath('data.2.id', $messages[2]->id)
            ->assertJsonStructure(['data', 'links', 'meta' => ['next_cursor', 'prev_cursor', 'per_page']]);
    }

    public function test_message_sending_is_rate_limited(): void
    {
        $visitor = Visitor::factory()->create();
        $conversation = Conversation::factory()->forVisitor($visitor)->create();

        $this->actingAsVisitor($visitor);

        for ($attempt = 0; $attempt < 30; $attempt++) {
            $this->postJson("/api/v1/widget/conversations/{$conversation->id}/messages", [
                'client_message_id' => (string) Str::uuid(),
                'text' => "Message {$attempt}",
            ])->assertCreated();
        }

        $this->postJson("/api/v1/widget/conversations/{$conversation->id}/messages", [
            'client_message_id' => (string) Str::uuid(),
            'text' => 'One too many',
        ])->assertTooManyRequests();
    }
}
