<?php

namespace App\Http\Resources;

use App\Models\Brand;
use App\Support\OriginAllowlist;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Server-side allowlist of brand settings that are safe to expose publicly.
 *
 * @mixin Brand
 */
class WidgetConfigResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $allowed = array_values($this->allowed_origins ?? []);
        $frameAncestors = OriginAllowlist::frameAncestors(
            $allowed,
            config('widget.preview_origins', []),
            (bool) config('widget.allow_localhost_origins', false),
        );

        return [
            'public_id' => $this->public_id,
            'name' => $this->name,
            'color' => $this->color,
            'greeting' => $this->greeting,
            'allowed_origins' => $allowed,
            'frame_ancestors' => $frameAncestors,
        ];
    }
}
