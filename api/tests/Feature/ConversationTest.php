<?php

namespace Tests\Feature;

use App\Enums\ConversationStatus;
use App\Enums\Role;
use App\Models\Brand;
use App\Models\Conversation;
use App\Models\Message;
use App\Models\Organization;
use App\Models\Visitor;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ConversationTest extends TestCase
{
    use RefreshDatabase;

    public function test_agent_inbox_is_scoped_to_accessible_brands(): void
    {
        $organization = Organization::factory()->create();
        $assignedBrand = Brand::factory()->for($organization)->create();
        $unassignedBrand = Brand::factory()->for($organization)->create();
        $agent = $this->createAssignedAgent($assignedBrand);

        $visible = Conversation::factory()->for($assignedBrand)->create();
        Conversation::factory()->for($unassignedBrand)->create();
        Conversation::factory()->create();

        $this->actingAs($agent)
            ->getJson('/api/v1/conversations')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $visible->id)
            ->assertJsonPath('data.0.brand.id', $assignedBrand->id)
            ->assertJsonStructure(['data' => [['id', 'visitor_name', 'status', 'unread_count', 'last_message_preview']], 'meta']);
    }

    public function test_inbox_filters_by_status_and_brand(): void
    {
        $organization = Organization::factory()->create();
        $owner = $this->createMember($organization, Role::Owner);
        $brandA = Brand::factory()->for($organization)->create();
        $brandB = Brand::factory()->for($organization)->create();

        $openA = Conversation::factory()->for($brandA)->create();
        Conversation::factory()->for($brandA)->closed()->create();
        Conversation::factory()->for($brandB)->create();

        $this->actingAs($owner)
            ->getJson("/api/v1/conversations?status=open&brand_id={$brandA->id}")
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $openA->id);

        $this->actingAs($owner)
            ->getJson('/api/v1/conversations?status=bogus')
            ->assertUnprocessable()
            ->assertJsonValidationErrors('status');
    }

    public function test_filtering_by_a_foreign_brand_is_forbidden(): void
    {
        $owner = $this->createMember(Organization::factory()->create(), Role::Owner);
        $foreignBrand = Brand::factory()->create();

        $this->actingAs($owner)
            ->getJson("/api/v1/conversations?brand_id={$foreignBrand->id}")
            ->assertForbidden();
    }

    public function test_agent_cannot_access_conversations_of_another_organization(): void
    {
        $owner = $this->createMember(Organization::factory()->create(), Role::Owner);
        $foreignConversation = Conversation::factory()->create();
        $message = Message::factory()->for($foreignConversation)->create();

        $this->actingAs($owner)->getJson("/api/v1/conversations/{$foreignConversation->id}/messages")->assertForbidden();
        $this->actingAs($owner)->postJson("/api/v1/conversations/{$foreignConversation->id}/messages", [
            'client_message_id' => fake()->uuid(),
            'text' => 'Hi',
        ])->assertForbidden();
        $this->actingAs($owner)->patchJson("/api/v1/conversations/{$foreignConversation->id}", ['status' => 'closed'])->assertForbidden();
        $this->actingAs($owner)->postJson("/api/v1/conversations/{$foreignConversation->id}/read", ['message_id' => $message->id])->assertForbidden();

        $this->assertSame(ConversationStatus::Open, $foreignConversation->fresh()->status);
    }

    public function test_agent_cannot_access_an_unassigned_brand_in_their_own_organization(): void
    {
        $organization = Organization::factory()->create();
        $agent = $this->createAssignedAgent(Brand::factory()->for($organization)->create());
        $otherConversation = Conversation::factory()->for(Brand::factory()->for($organization))->create();

        $this->actingAs($agent)->getJson("/api/v1/conversations/{$otherConversation->id}/messages")->assertForbidden();
    }

    public function test_agent_can_change_conversation_status(): void
    {
        $brand = Brand::factory()->create();
        $agent = $this->createAssignedAgent($brand);
        $conversation = Conversation::factory()->for($brand)->create();

        $this->actingAs($agent)
            ->patchJson("/api/v1/conversations/{$conversation->id}", ['status' => 'closed'])
            ->assertOk()
            ->assertJsonPath('data.status', 'closed');

        $this->assertSame(ConversationStatus::Closed, $conversation->fresh()->status);

        $this->actingAs($agent)
            ->patchJson("/api/v1/conversations/{$conversation->id}", ['status' => 'archived'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('status');
    }

    public function test_visitor_token_does_not_authenticate_dashboard_endpoints(): void
    {
        $visitor = Visitor::factory()->create();
        $conversation = Conversation::factory()->forVisitor($visitor)->create();

        $this->actingAsVisitor($visitor)->getJson('/api/v1/conversations')->assertUnauthorized();
        $this->actingAsVisitor($visitor)
            ->patchJson("/api/v1/conversations/{$conversation->id}", ['status' => 'closed'])
            ->assertUnauthorized();

        $this->assertSame(ConversationStatus::Open, $conversation->fresh()->status);
    }

    public function test_unknown_conversation_returns_not_found(): void
    {
        $owner = $this->createMember(Organization::factory()->create(), Role::Owner);

        $this->actingAs($owner)
            ->getJson('/api/v1/conversations/01890000-0000-7000-8000-000000000000/messages')
            ->assertNotFound();
    }
}
