<?php

namespace App\Http\Resources;

use App\Models\Brand;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Dashboard view of a brand (authenticated agents only).
 *
 * @mixin Brand
 */
class BrandResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'organization_id' => $this->organization_id,
            'name' => $this->name,
            'domain' => $this->domain,
            'timezone' => $this->timezone,
            'color' => $this->color,
            'public_id' => $this->public_id,
            'allowed_origins' => $this->allowed_origins ?? [],
            'greeting' => $this->greeting,
            'created_at' => $this->created_at?->toIso8601ZuluString(),
        ];
    }
}
