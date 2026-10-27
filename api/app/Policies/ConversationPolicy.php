<?php

namespace App\Policies;

use App\Models\Conversation;
use App\Models\User;
use App\Models\Visitor;

/**
 * Agents reach conversations through brand access; visitors only reach their own.
 */
class ConversationPolicy
{
    public function view(User|Visitor $actor, Conversation $conversation): bool
    {
        if ($actor instanceof Visitor) {
            return $conversation->visitor_id === $actor->getKey()
                && $conversation->brand_id === $actor->brand_id;
        }

        return $actor->canAccessBrand($conversation->brand);
    }

    public function reply(User|Visitor $actor, Conversation $conversation): bool
    {
        return $this->view($actor, $conversation);
    }

    /**
     * Only agents may change the conversation status.
     */
    public function update(User|Visitor $actor, Conversation $conversation): bool
    {
        return $actor instanceof User && $this->view($actor, $conversation);
    }
}
