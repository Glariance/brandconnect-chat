<?php

namespace Tests\Feature;

use App\Enums\Role;
use App\Events\VisitorPresenceUpdated;
use App\Models\Brand;
use App\Models\Organization;
use App\Models\Visitor;
use App\Models\VisitorPresence;
use App\Support\PagePath;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Str;
use Tests\TestCase;

class VisitorPresenceTest extends TestCase
{
    use RefreshDatabase;

    public function test_page_path_strips_query_and_fragment(): void
    {
        $this->assertSame('/pricing', PagePath::sanitize('/pricing?token=secret#frag'));
        $this->assertSame('/a/b', PagePath::sanitize('https://example.com/a/b?x=1'));
        $this->assertSame('/', PagePath::sanitize(null));
    }

    public function test_visitor_heartbeat_creates_presence_without_conversation(): void
    {
        Event::fake([VisitorPresenceUpdated::class]);

        $visitor = Visitor::factory()->create();
        $tabId = (string) Str::uuid();

        $this->actingAsVisitor($visitor)
            ->postJson('/api/v1/widget/presence', [
                'tab_id' => $tabId,
                'page' => '/pricing?utm=1#x',
                'chat_opened' => false,
                'activity' => true,
            ])
            ->assertCreated()
            ->assertJsonPath('data.visitor_id', $visitor->id)
            ->assertJsonPath('data.page', '/pricing')
            ->assertJsonPath('data.status', 'active')
            ->assertJsonPath('data.chat_opened', false);

        $this->assertDatabaseCount('conversations', 0);
        $this->assertDatabaseHas('visitor_presences', [
            'visitor_id' => $visitor->id,
            'tab_id' => $tabId,
            'page' => '/pricing',
            'chat_opened' => false,
        ]);

        Event::assertDispatched(VisitorPresenceUpdated::class, function (VisitorPresenceUpdated $event) use ($visitor): bool {
            return $event->reason === VisitorPresenceUpdated::REASON_APPEARED
                && $event->brandId === (int) $visitor->brand_id
                && $event->broadcastAs() === 'presence.updated'
                && $event->broadcastOn()[0]->name === 'private-brands.'.$visitor->brand_id.'.presence';
        });
    }

    public function test_multi_tab_keeps_visitor_online_when_one_tab_goes_stale(): void
    {
        $brand = Brand::factory()->create();
        $visitor = Visitor::factory()->for($brand)->create();
        $tabA = (string) Str::uuid();
        $tabB = (string) Str::uuid();
        $now = now();

        VisitorPresence::query()->create([
            'visitor_id' => $visitor->id,
            'brand_id' => $brand->id,
            'tab_id' => $tabA,
            'page' => '/a',
            'first_seen_at' => $now->copy()->subMinutes(5),
            'last_seen_at' => $now->copy()->subSeconds(120),
            'last_activity_at' => $now->copy()->subSeconds(120),
            'chat_opened' => false,
        ]);
        VisitorPresence::query()->create([
            'visitor_id' => $visitor->id,
            'brand_id' => $brand->id,
            'tab_id' => $tabB,
            'page' => '/b',
            'first_seen_at' => $now->copy()->subMinutes(5),
            'last_seen_at' => $now,
            'last_activity_at' => $now,
            'chat_opened' => false,
        ]);

        $agent = $this->createAssignedAgent($brand);
        $this->actingAs($agent)
            ->getJson('/api/v1/live-visitors')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.visitor_id', $visitor->id)
            ->assertJsonPath('data.0.page', '/b');
    }

    public function test_idle_when_heartbeat_without_recent_activity(): void
    {
        $visitor = Visitor::factory()->create();
        $tabId = (string) Str::uuid();

        $this->actingAsVisitor($visitor)
            ->postJson('/api/v1/widget/presence', [
                'tab_id' => $tabId,
                'page' => '/',
                'activity' => true,
            ])
            ->assertCreated();

        VisitorPresence::query()->where('tab_id', $tabId)->update([
            'last_activity_at' => now()->subSeconds(70),
            'last_seen_at' => now(),
        ]);

        $this->postJson('/api/v1/widget/presence', [
            'tab_id' => $tabId,
            'page' => '/',
            'activity' => false,
        ])->assertOk()->assertJsonPath('data.status', 'idle');
    }

    public function test_agents_see_only_accessible_brand_visitors(): void
    {
        $brandA = Brand::factory()->create();
        $brandB = Brand::factory()->create();
        $visitorA = Visitor::factory()->for($brandA)->create();
        $visitorB = Visitor::factory()->for($brandB)->create();
        $now = now();

        foreach ([['v' => $visitorA, 'b' => $brandA, 'p' => '/a'], ['v' => $visitorB, 'b' => $brandB, 'p' => '/b']] as $row) {
            VisitorPresence::query()->create([
                'visitor_id' => $row['v']->id,
                'brand_id' => $row['b']->id,
                'tab_id' => (string) Str::uuid(),
                'page' => $row['p'],
                'first_seen_at' => $now,
                'last_seen_at' => $now,
                'last_activity_at' => $now,
                'chat_opened' => false,
            ]);
        }

        $agent = $this->createAssignedAgent($brandA);
        $this->actingAs($agent)
            ->getJson('/api/v1/live-visitors')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.visitor_id', $visitorA->id);

        $this->actingAs($agent)
            ->getJson('/api/v1/live-visitors?brand_id='.$brandB->id)
            ->assertForbidden();
    }

    public function test_cross_organization_access_denied(): void
    {
        $brand = Brand::factory()->create();
        $visitor = Visitor::factory()->for($brand)->create();
        $now = now();
        VisitorPresence::query()->create([
            'visitor_id' => $visitor->id,
            'brand_id' => $brand->id,
            'tab_id' => (string) Str::uuid(),
            'page' => '/',
            'first_seen_at' => $now,
            'last_seen_at' => $now,
            'last_activity_at' => $now,
            'chat_opened' => false,
        ]);

        $outsider = $this->createMember(Organization::factory()->create(), Role::Owner);
        $this->actingAs($outsider)
            ->getJson('/api/v1/live-visitors')
            ->assertOk()
            ->assertJsonCount(0, 'data');
    }

    public function test_guest_cannot_heartbeat_or_list(): void
    {
        $this->postJson('/api/v1/widget/presence', ['tab_id' => (string) Str::uuid()])->assertUnauthorized();
        $this->getJson('/api/v1/live-visitors')->assertUnauthorized();
    }

    public function test_presence_is_rate_limited(): void
    {
        $visitor = Visitor::factory()->create();
        $this->actingAsVisitor($visitor);

        for ($i = 0; $i < 30; $i++) {
            $this->postJson('/api/v1/widget/presence', [
                'tab_id' => (string) Str::uuid(),
                'page' => '/',
            ])->assertSuccessful();
        }

        $this->postJson('/api/v1/widget/presence', [
            'tab_id' => (string) Str::uuid(),
            'page' => '/',
        ])->assertStatus(429);
    }
}
