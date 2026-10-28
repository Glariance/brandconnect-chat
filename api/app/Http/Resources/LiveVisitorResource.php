<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin array<string, mixed>
 */
class LiveVisitorResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var array<string, mixed> $row */
        $row = is_array($this->resource) ? $this->resource : (array) $this->resource;

        return [
            'visitor_id' => (int) ($row['visitor_id'] ?? 0),
            'brand_id' => (int) ($row['brand_id'] ?? 0),
            'brand_name' => $row['brand_name'] ?? null,
            'label' => $row['label'] ?? 'Visitor',
            'page' => $row['page'] ?? '/',
            'first_seen_at' => $row['first_seen_at'] ?? null,
            'last_seen_at' => $row['last_seen_at'] ?? null,
            'status' => $row['status'] ?? 'offline',
            'chat_opened' => (bool) ($row['chat_opened'] ?? false),
            'tab_count' => (int) ($row['tab_count'] ?? 0),
            'version' => $row['version'] ?? $row['last_seen_at'] ?? null,
        ];
    }
}
