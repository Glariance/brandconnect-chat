<?php

namespace App\Http\Resources;

use App\Models\VisitorSession;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Returned once at issue time; the plain token is not recoverable afterwards.
 *
 * @mixin VisitorSession
 */
class VisitorSessionResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'token' => $this->plainTextToken,
            'token_type' => 'Bearer',
            'visitor_id' => $this->visitor_id,
            'expires_at' => $this->expires_at->toIso8601ZuluString(),
        ];
    }
}
