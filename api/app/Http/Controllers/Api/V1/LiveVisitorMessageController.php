<?php

namespace App\Http\Controllers\Api\V1;

use App\Enums\ConversationStatus;
use App\Events\InboxConversationUpdated;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\StoreLiveVisitorMessageRequest;
use App\Http\Resources\ConversationResource;
use App\Http\Resources\MessageResource;
use App\Models\Conversation;
use App\Models\User;
use App\Models\Visitor;
use App\Support\PagePath;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

class LiveVisitorMessageController extends Controller
{
    /**
     * Agent-initiated (or continued) direct message to a live visitor.
     * Resumes the visitor's latest open conversation or creates one.
     */
    public function store(StoreLiveVisitorMessageRequest $request, Visitor $visitor): JsonResponse
    {
        /** @var User $agent */
        $agent = $request->user();

        abort_unless(
            $agent->canAccessBrand($visitor->brand),
            403,
            'You do not have access to this brand.',
        );

        $validated = $request->validated();
        $page = PagePath::sanitize($validated['page'] ?? '/');

        [$conversation, $message, $created] = DB::transaction(function () use ($visitor, $agent, $validated, $page) {
            $conversation = $visitor->conversations()
                ->where('status', '!=', ConversationStatus::Closed->value)
                ->latest('last_message_at')
                ->lockForUpdate()
                ->first();

            $wasCreated = $conversation === null;

            $conversation ??= $visitor->conversations()->create([
                'brand_id' => $visitor->brand_id,
                'status' => ConversationStatus::Open,
                'page' => $page,
                'last_message_at' => now(),
            ]);

            if ($wasCreated) {
                InboxConversationUpdated::dispatch(
                    $conversation->fresh(['visitor']) ?? $conversation,
                    InboxConversationUpdated::REASON_CREATED,
                );
            }

            [$message, $messageCreated] = $conversation->recordMessage(
                $agent,
                $validated['client_message_id'],
                $validated['text'],
            );

            return [$conversation->fresh(['visitor']), $message, $wasCreated || $messageCreated];
        });

        $conversation = Conversation::query()
            ->whereKey($conversation->getKey())
            ->with('visitor')
            ->withUnreadCountFor($agent)
            ->firstOrFail();

        return response()->json([
            'data' => [
                'message' => (new MessageResource($message))->resolve(),
                'conversation' => (new ConversationResource($conversation))->resolve(),
            ],
        ], $created ? 201 : 200);
    }
}
