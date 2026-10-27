<?php

namespace App\Http\Resources;

use App\Models\Message;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Shared by agents, visitors and broadcasts, so it must only contain
 * fields that are safe for the visitor to see.
 *
 * @mixin Message
 */
class MessageResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'conversation_id' => $this->conversation_id,
            'client_message_id' => $this->client_message_id,
            'sender_type' => $this->sender_type->value,
            'body' => $this->body,
            'created_at' => $this->created_at?->toIso8601ZuluString(),
        ];
    }
}
