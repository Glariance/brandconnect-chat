<?php

namespace App\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

/**
 * Brand-scoped live visitor presence for dashboard agents.
 *
 * Broadcast synchronously (ShouldBroadcastNow) so Live Visitors is not delayed
 * by the queue worker sleep interval used for chat message fan-out.
 * Not ShouldDispatchAfterCommit: the heartbeat row is already persisted before
 * dispatch, and wrapping dispatch lets us catch Reverb failures without HTTP 500.
 */
class VisitorPresenceUpdated implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public const REASON_APPEARED = 'appeared';

    public const REASON_UPDATED = 'updated';

    public const REASON_OFFLINE = 'offline';

    /**
     * @param  array<string, mixed>  $visitor
     */
    public function __construct(
        public int $brandId,
        public array $visitor,
        public string $reason,
    ) {}

    /**
     * @return array<int, PrivateChannel>
     */
    public function broadcastOn(): array
    {
        return [
            new PrivateChannel('brands.'.$this->brandId.'.presence'),
        ];
    }

    public function broadcastAs(): string
    {
        return 'presence.updated';
    }

    /**
     * @return array<string, mixed>
     */
    public function broadcastWith(): array
    {
        return [
            'visitor' => $this->visitor,
            'reason' => $this->reason,
        ];
    }
}
