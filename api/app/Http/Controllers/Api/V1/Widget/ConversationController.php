<?php

namespace App\Http\Controllers\Api\V1\Widget;

use App\Enums\ConversationStatus;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Widget\StoreVisitorConversationRequest;
use App\Http\Resources\ConversationResource;
use App\Models\Conversation;
use App\Models\Visitor;
use Illuminate\Http\JsonResponse;

class ConversationController extends Controller
{
    /**
     * Resume the visitor's latest unclosed conversation (200) or start one (201).
     */
    public function store(StoreVisitorConversationRequest $request): JsonResponse
    {
        /** @var Visitor $visitor */
        $visitor = $request->user();

        $conversation = $visitor->conversations()
            ->where('status', '!=', ConversationStatus::Closed->value)
            ->latest('last_message_at')
            ->first();

        $wasCreated = $conversation === null;

        $conversation ??= $visitor->conversations()->create([
            'brand_id' => $visitor->brand_id,
            'status' => ConversationStatus::Open,
            'page' => $request->validated('page'),
            'last_message_at' => now(),
        ]);

        $conversation = Conversation::query()
            ->whereKey($conversation->getKey())
            ->with('visitor')
            ->withUnreadCountFor($visitor)
            ->firstOrFail();

        return ConversationResource::make($conversation)->response()->setStatusCode($wasCreated ? 201 : 200);
    }
}
