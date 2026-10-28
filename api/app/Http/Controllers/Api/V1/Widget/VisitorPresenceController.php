<?php

namespace App\Http\Controllers\Api\V1\Widget;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Widget\UpsertVisitorPresenceRequest;
use App\Http\Resources\LiveVisitorResource;
use App\Models\Visitor;
use App\Services\VisitorPresenceService;
use Illuminate\Http\JsonResponse;

class VisitorPresenceController extends Controller
{
    public function __construct(private VisitorPresenceService $presence) {}

    /**
     * Heartbeat for the authenticated visitor's current browser tab.
     */
    public function store(UpsertVisitorPresenceRequest $request): JsonResponse
    {
        /** @var Visitor $visitor */
        $visitor = $request->user();

        $result = $this->presence->heartbeat($visitor, $request->validated());

        return LiveVisitorResource::make($result['summary'])
            ->response()
            ->setStatusCode($result['appeared'] ? 201 : 200);
    }
}
