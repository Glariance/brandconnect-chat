<?php

namespace App\Http\Controllers\Api\V1\Widget;

use App\Enums\ConversationStatus;
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
     * Includes open_conversation_id so agent-initiated threads can be discovered
     * without the visitor creating a conversation first.
     */
    public function store(UpsertVisitorPresenceRequest $request): JsonResponse
    {
        /** @var Visitor $visitor */
        $visitor = $request->user();

        $result = $this->presence->heartbeat($visitor, $request->validated());

        $openConversationId = $visitor->conversations()
            ->where('status', '!=', ConversationStatus::Closed->value)
            ->latest('last_message_at')
            ->value('id');

        $summary = $result['summary'];
        $summary['open_conversation_id'] = $openConversationId;

        return LiveVisitorResource::make($summary)
            ->response()
            ->setStatusCode($result['appeared'] ? 201 : 200);
    }
}
