<?php

namespace App\Models;

use App\Enums\SenderType;
use Database\Factories\MessageFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable(['conversation_id', 'client_message_id', 'sender_type', 'sender_user_id', 'sender_visitor_id', 'body'])]
class Message extends Model
{
    /** @use HasFactory<MessageFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'sender_type' => SenderType::class,
        ];
    }

    /**
     * @return BelongsTo<Conversation, $this>
     */
    public function conversation(): BelongsTo
    {
        return $this->belongsTo(Conversation::class);
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function senderUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'sender_user_id');
    }

    /**
     * @return BelongsTo<Visitor, $this>
     */
    public function senderVisitor(): BelongsTo
    {
        return $this->belongsTo(Visitor::class, 'sender_visitor_id');
    }

    public function wasSentBy(User|Visitor $sender): bool
    {
        if ($sender instanceof Visitor) {
            return $this->sender_type === SenderType::Visitor && $this->sender_visitor_id === $sender->getKey();
        }

        return $this->sender_type === SenderType::Agent && $this->sender_user_id === $sender->getKey();
    }
}
