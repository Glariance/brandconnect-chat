<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\MarkConversationReadRequest;
use App\Models\Conversation;
use Illuminate\Http\Response;

/**
 * Advances the agent or visitor read cursor depending on the authenticated actor.
 */
class ConversationReadController extends Controller
{
    public function __invoke(MarkConversationReadRequest $request, Conversation $conversation): Response
    {
        $conversation->markReadBy(
            $request->user(),
            $conversation->messages()->findOrFail($request->integer('message_id')),
        );

        return response()->noContent();
    }
}
