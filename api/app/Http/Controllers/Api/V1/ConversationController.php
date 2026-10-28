<?php

namespace App\Http\Controllers\Api\V1;

use App\Events\InboxConversationUpdated;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\IndexConversationsRequest;
use App\Http\Requests\Api\V1\UpdateConversationRequest;
use App\Http\Resources\ConversationResource;
use App\Models\Conversation;
use App\Models\User;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class ConversationController extends Controller
{
    /**
     * Agent inbox, scoped to brands the user can access.
     */
    public function index(IndexConversationsRequest $request): AnonymousResourceCollection
    {
        /** @var User $user */
        $user = $request->user();

        $query = Conversation::query()
            ->whereIn('brand_id', $user->accessibleBrands()->select('brands.id'))
            ->with(['brand', 'visitor'])
            ->withUnreadCountFor($user);

        if ($request->filled('brand_id')) {
            abort_unless(
                $user->accessibleBrands()->whereKey($request->integer('brand_id'))->exists(),
                403,
                'You do not have access to this brand.',
            );

            $query->where('brand_id', $request->integer('brand_id'));
        }

        if ($request->filled('status')) {
            $query->where('status', $request->validated('status'));
        }

        $conversations = $query
            ->orderByDesc('last_message_at')
            ->orderByDesc('id')
            ->cursorPaginate(50);

        return ConversationResource::collection($conversations);
    }

    public function update(UpdateConversationRequest $request, Conversation $conversation): ConversationResource
    {
        $conversation->update(['status' => $request->validated('status')]);

        InboxConversationUpdated::dispatch(
            $conversation->fresh(['visitor']) ?? $conversation,
            InboxConversationUpdated::REASON_STATUS,
        );

        $conversation = Conversation::query()
            ->whereKey($conversation->getKey())
            ->with(['brand', 'visitor'])
            ->withUnreadCountFor($request->user())
            ->firstOrFail();

        return ConversationResource::make($conversation);
    }
}
