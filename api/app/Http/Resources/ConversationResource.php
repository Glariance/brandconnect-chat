<?php

namespace App\Http\Resources;

use App\Models\Conversation;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin Conversation
 */
class ConversationResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'brand_id' => $this->brand_id,
            'brand' => BrandResource::make($this->whenLoaded('brand')),
            'visitor_id' => $this->visitor_id,
            'visitor_name' => $this->whenLoaded('visitor', fn () => $this->visitor->displayName()),
            'page' => $this->page,
            'status' => $this->status->value,
            'unread_count' => (int) ($this->unread_count ?? 0),
            'last_message_preview' => $this->last_message_preview,
            'last_message_at' => $this->last_message_at?->toIso8601ZuluString(),
            'agent_last_read_message_id' => $this->agent_last_read_message_id,
            'visitor_last_read_message_id' => $this->visitor_last_read_message_id,
            'created_at' => $this->created_at?->toIso8601ZuluString(),
            'updated_at' => $this->updated_at?->toIso8601ZuluString(),
        ];
    }
}
