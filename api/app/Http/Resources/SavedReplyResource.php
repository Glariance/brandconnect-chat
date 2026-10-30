<?php

namespace App\Http\Resources;

use App\Models\SavedReply;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin SavedReply
 */
class SavedReplyResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'organization_id' => $this->organization_id,
            'brand_id' => $this->brand_id,
            'brand_name' => $this->whenLoaded('brand', fn () => $this->brand?->name),
            'scope' => $this->brand_id === null ? 'organization' : 'brand',
            'title' => $this->title,
            'shortcut' => $this->shortcut,
            'body' => $this->body,
            'is_active' => $this->is_active,
            'archived_at' => $this->archived_at?->toIso8601String(),
            'created_at' => $this->created_at?->toIso8601String(),
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }
}
