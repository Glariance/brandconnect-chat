<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\IndexMessagesRequest;
use App\Http\Requests\Api\V1\StoreMessageRequest;
use App\Http\Resources\MessageResource;
use App\Models\Conversation;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

/**
 * Mounted on both the dashboard (sanctum) and widget (visitor) route groups;
 * the authenticated actor decides the sender identity.
 */
class ConversationMessageController extends Controller
{
    /**
     * With `after_id`: messages newer than that ID, oldest first (reconnect catch-up).
     * Without: the latest page in chronological order; `next_cursor` loads older messages.
     */
    public function index(IndexMessagesRequest $request, Conversation $conversation): AnonymousResourceCollection
    {
        $messages = $conversation->messages();

        if ($request->filled('after_id')) {
            return MessageResource::collection(
                $messages->where('id', '>', $request->integer('after_id'))->orderBy('id')->cursorPaginate(100),
            );
        }

        $page = $messages->orderByDesc('id')->cursorPaginate(50);

        $page->setCollection($page->getCollection()->reverse()->values());

        return MessageResource::collection($page);
    }

    /**
     * Returns 201 for a new message and 200 when a retry matched an existing one.
     */
    public function store(StoreMessageRequest $request, Conversation $conversation): JsonResponse
    {
        [$message, $wasCreated] = $conversation->recordMessage(
            $request->user(),
            $request->validated('client_message_id'),
            $request->validated('text'),
        );

        return MessageResource::make($message)->response()->setStatusCode($wasCreated ? 201 : 200);
    }
}
