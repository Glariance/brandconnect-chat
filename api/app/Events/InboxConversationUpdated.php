<?php

namespace App\Events;

use App\Models\Conversation;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Contracts\Events\ShouldDispatchAfterCommit;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

/**
 * Brand-scoped inbox summary for dashboard agents.
 * Does not include actor-specific unread counts or message bodies.
 */
class InboxConversationUpdated implements ShouldBroadcast, ShouldDispatchAfterCommit
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public const REASON_CREATED = 'created';

    public const REASON_MESSAGE = 'message';

    public const REASON_STATUS = 'status';

    public function __construct(
        public Conversation $conversation,
        public string $reason,
    ) {
        $this->conversation->loadMissing('visitor');
    }

    /**
     * @return array<int, PrivateChannel>
     */
    public function broadcastOn(): array
    {
        return [
            new PrivateChannel('brands.'.$this->conversation->brand_id.'.inbox'),
        ];
    }

    public function broadcastAs(): string
    {
        return 'inbox.conversation.updated';
    }

    /**
     * @return array<string, mixed>
     */
    public function broadcastWith(): array
    {
        $conversation = $this->conversation;
        $version = $conversation->updated_at?->toIso8601ZuluString()
            ?? $conversation->last_message_at?->toIso8601ZuluString()
            ?? now()->toIso8601ZuluString();

        return [
            'conversation' => [
                'id' => $conversation->id,
                'brand_id' => (int) $conversation->brand_id,
                'status' => $conversation->status->value,
                'visitor_name' => $conversation->visitor?->displayName() ?? 'Visitor',
                'page' => $conversation->page,
                'last_message_preview' => $conversation->last_message_preview,
                'last_message_at' => $conversation->last_message_at?->toIso8601ZuluString(),
                'updated_at' => $conversation->updated_at?->toIso8601ZuluString(),
                'version' => $version,
            ],
            'reason' => $this->reason,
        ];
    }
}
