<?php

namespace Tests\Feature;

use App\Enums\Role;
use App\Models\Brand;
use App\Models\Conversation;
use App\Models\Message;
use App\Models\Organization;
use App\Models\Visitor;
use App\Models\VisitorSession;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class VisitorSessionTest extends TestCase
{
    use RefreshDatabase;

    public function test_session_bootstrap_issues_a_token_and_stores_only_its_hash(): void
    {
        $brand = Brand::factory()->create();

        $response = $this->postJson("/api/v1/widget/brands/{$brand->public_id}/sessions")
            ->assertCreated()
            ->assertJsonStructure(['data' => ['token', 'token_type', 'visitor_id', 'expires_at']]);

        $token = $response->json('data.token');
        $session = VisitorSession::query()->sole();

        $this->assertSame(hash('sha256', $token), $session->token_hash);
        $this->assertDatabaseMissing('visitor_sessions', ['token_hash' => $token]);
        $this->assertSame($brand->id, $session->visitor->brand_id);
        $this->assertTrue($session->expires_at->isFuture());
    }

    public function test_session_bootstrap_for_unknown_brand_is_not_found(): void
    {
        $this->postJson('/api/v1/widget/brands/brd_unknown/sessions')->assertNotFound();
    }

    public function test_each_session_creates_a_new_anonymous_visitor(): void
    {
        $brand = Brand::factory()->create();

        $first = $this->postJson("/api/v1/widget/brands/{$brand->public_id}/sessions")->json('data.visitor_id');
        $second = $this->postJson("/api/v1/widget/brands/{$brand->public_id}/sessions")->json('data.visitor_id');

        $this->assertNotSame($first, $second);
    }

    public function test_visitor_session_creation_is_rate_limited(): void
    {
        $brand = Brand::factory()->create();

        for ($attempt = 0; $attempt < 10; $attempt++) {
            $this->postJson("/api/v1/widget/brands/{$brand->public_id}/sessions")->assertCreated();
        }

        $this->postJson("/api/v1/widget/brands/{$brand->public_id}/sessions")->assertTooManyRequests();
    }

    public function test_visitor_starts_and_then_resumes_their_open_conversation(): void
    {
        $visitor = Visitor::factory()->create();

        $conversationId = $this->actingAsVisitor($visitor)
            ->postJson('/api/v1/widget/conversations', ['page' => '/pricing'])
            ->assertCreated()
            ->assertJsonPath('data.page', '/pricing')
            ->assertJsonPath('data.brand_id', $visitor->brand_id)
            ->assertJsonPath('data.status', 'open')
            ->json('data.id');

        $this->postJson('/api/v1/widget/conversations', ['page' => '/other'])
            ->assertOk()
            ->assertJsonPath('data.id', $conversationId);
    }

    public function test_guests_without_a_token_are_rejected(): void
    {
        $conversation = Conversation::factory()->create();

        $this->postJson('/api/v1/widget/conversations')->assertUnauthorized();
        $this->getJson("/api/v1/widget/conversations/{$conversation->id}/messages")->assertUnauthorized();
        $this->withToken('not-a-real-token')->getJson("/api/v1/widget/conversations/{$conversation->id}/messages")->assertUnauthorized();
    }

    public function test_expired_and_revoked_tokens_are_rejected(): void
    {
        $visitor = Visitor::factory()->create();

        foreach ([VisitorSession::factory()->expired(), VisitorSession::factory()->revoked()] as $factory) {
            $token = 'tok_'.fake()->unique()->sha256();
            $factory->for($visitor)->create(['token_hash' => VisitorSession::hashToken($token)]);

            $this->withVisitorToken($token)->postJson('/api/v1/widget/conversations')->assertUnauthorized();
        }
    }

    public function test_logout_revokes_only_the_current_token(): void
    {
        $visitor = Visitor::factory()->create();
        $current = VisitorSession::issueFor($visitor);
        $other = VisitorSession::issueFor($visitor);

        $this->withVisitorToken($current->plainTextToken)
            ->postJson('/api/v1/widget/sessions/logout')
            ->assertNoContent();

        $this->assertNotNull($current->fresh()->revoked_at);
        $this->assertNull($other->fresh()->revoked_at);

        $this->withVisitorToken($current->plainTextToken)->postJson('/api/v1/widget/conversations')->assertUnauthorized();
        $this->withVisitorToken($other->plainTextToken)->postJson('/api/v1/widget/conversations')->assertCreated();
    }

    public function test_second_visitor_cannot_read_or_write_the_first_visitors_conversation(): void
    {
        $brand = Brand::factory()->create();
        $firstVisitor = Visitor::factory()->for($brand)->create();
        $secondVisitor = Visitor::factory()->for($brand)->create();
        $conversation = Conversation::factory()->forVisitor($firstVisitor)->create();
        $message = Message::factory()->for($conversation)->create(['body' => 'private to first visitor']);

        $this->actingAsVisitor($secondVisitor);

        $this->getJson("/api/v1/widget/conversations/{$conversation->id}/messages")->assertForbidden();
        $this->postJson("/api/v1/widget/conversations/{$conversation->id}/messages", [
            'client_message_id' => fake()->uuid(),
            'text' => 'intrusion',
        ])->assertForbidden();
        $this->postJson("/api/v1/widget/conversations/{$conversation->id}/read", ['message_id' => $message->id])->assertForbidden();

        $this->assertSame(1, $conversation->messages()->count());

        $this->actingAsVisitor($firstVisitor)
            ->getJson("/api/v1/widget/conversations/{$conversation->id}/messages")
            ->assertOk()
            ->assertJsonPath('data.0.body', 'private to first visitor');
    }

    public function test_dashboard_session_does_not_grant_visitor_access(): void
    {
        $brand = Brand::factory()->create();
        $owner = $this->createMember($brand->organization, Role::Owner);
        $conversation = Conversation::factory()->for($brand)->create();

        $this->actingAs($owner)->getJson("/api/v1/widget/conversations/{$conversation->id}/messages")->assertUnauthorized();
        $this->actingAs($owner)->postJson('/api/v1/widget/conversations')->assertUnauthorized();
    }

    public function test_visitor_of_another_brand_cannot_access_conversation_even_with_matching_ids(): void
    {
        $visitor = Visitor::factory()->for(Brand::factory()->for(Organization::factory()))->create();
        $conversation = Conversation::factory()->create();

        $this->actingAsVisitor($visitor)
            ->getJson("/api/v1/widget/conversations/{$conversation->id}/messages")
            ->assertForbidden();
    }
}
