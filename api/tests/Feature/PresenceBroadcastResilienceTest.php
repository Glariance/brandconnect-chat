<?php

namespace Tests\Feature;

use App\Events\VisitorPresenceUpdated;
use App\Models\Visitor;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Str;
use Tests\TestCase;

class PresenceBroadcastResilienceTest extends TestCase
{
    use RefreshDatabase;

    public function test_heartbeat_returns_success_when_synchronous_broadcast_throws(): void
    {
        $visitor = Visitor::factory()->create();
        $tabId = (string) Str::uuid();

        // Simulate Reverb/transport failure during ShouldBroadcastNow.
        Event::listen(VisitorPresenceUpdated::class, function (): void {
            throw new \RuntimeException('Simulated Reverb unavailable');
        });

        $this->actingAsVisitor($visitor)
            ->postJson('/api/v1/widget/presence', [
                'tab_id' => $tabId,
                'page' => '/pricing',
                'chat_opened' => false,
                'activity' => true,
            ])
            ->assertCreated()
            ->assertJsonPath('data.visitor_id', $visitor->id);

        $this->assertDatabaseHas('visitor_presences', [
            'visitor_id' => $visitor->id,
            'tab_id' => $tabId,
            'page' => '/pricing',
        ]);
    }
}
