<?php

namespace Tests\Feature;

use App\Models\Brand;
use App\Models\Conversation;
use App\Models\Message;
use App\Models\Visitor;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ReadCursorTest extends TestCase
{
    use RefreshDatabase;

    public function test_agent_read_cursor_updates_only_the_target_conversation(): void
    {
        $brand = Brand::factory()->create();
        $agent = $this->createAssignedAgent($brand);
        $conversation = Conversation::factory()->for($brand)->create();
        $otherConversation = Conversation::factory()->for($brand)->create();
        $messages = Message::factory()->for($conversation)->count(2)->create();
        Message::factory()->for($otherConversation)->create();

        $this->actingAs($agent)
            ->getJson('/api/v1/conversations')
            ->assertJsonPath('data.0.unread_count', fn (int $count) => $count >= 1);

        $this->actingAs($agent)
            ->postJson("/api/v1/conversations/{$conversation->id}/read", ['message_id' => $messages[1]->id])
            ->assertNoContent();

        $this->assertSame($messages[1]->id, $conversation->fresh()->agent_last_read_message_id);
        $this->assertNull($conversation->fresh()->visitor_last_read_message_id);
        $this->assertNull($otherConversation->fresh()->agent_last_read_message_id);

        $unreadById = collect($this->actingAs($agent)->getJson('/api/v1/conversations')->json('data'))
            ->pluck('unread_count', 'id');

        $this->assertSame(0, $unreadById[$conversation->id]);
        $this->assertSame(1, $unreadById[$otherConversation->id]);
    }

    public function test_read_cursor_rejects_a_message_from_another_conversation(): void
    {
        $brand = Brand::factory()->create();
        $agent = $this->createAssignedAgent($brand);
        $conversation = Conversation::factory()->for($brand)->create();
        $otherConversation = Conversation::factory()->for($brand)->create();
        $foreignMessage = Message::factory()->for($otherConversation)->create();

        $this->actingAs($agent)
            ->postJson("/api/v1/conversations/{$conversation->id}/read", ['message_id' => $foreignMessage->id])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('message_id');

        $this->actingAs($agent)
            ->postJson("/api/v1/conversations/{$conversation->id}/read", ['message_id' => 'abc'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('message_id');

        $this->assertNull($conversation->fresh()->agent_last_read_message_id);
        $this->assertNull($otherConversation->fresh()->agent_last_read_message_id);
    }

    public function test_read_cursor_never_moves_backwards(): void
    {
        $brand = Brand::factory()->create();
        $agent = $this->createAssignedAgent($brand);
        $conversation = Conversation::factory()->for($brand)->create();
        $messages = Message::factory()->for($conversation)->count(3)->create();

        $this->actingAs($agent)->postJson("/api/v1/conversations/{$conversation->id}/read", ['message_id' => $messages[2]->id])->assertNoContent();
        $this->actingAs($agent)->postJson("/api/v1/conversations/{$conversation->id}/read", ['message_id' => $messages[0]->id])->assertNoContent();

        $this->assertSame($messages[2]->id, $conversation->fresh()->agent_last_read_message_id);
    }

    public function test_visitor_read_cursor_is_separate_from_agent_cursor(): void
    {
        $visitor = Visitor::factory()->create();
        $conversation = Conversation::factory()->forVisitor($visitor)->create();
        $message = Message::factory()->for($conversation)->create();

        $this->actingAsVisitor($visitor)
            ->postJson("/api/v1/widget/conversations/{$conversation->id}/read", ['message_id' => $message->id])
            ->assertNoContent();

        $this->assertSame($message->id, $conversation->fresh()->visitor_last_read_message_id);
        $this->assertNull($conversation->fresh()->agent_last_read_message_id);
    }
}
