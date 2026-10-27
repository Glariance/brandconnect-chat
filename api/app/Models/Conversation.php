<?php

namespace App\Models;

use App\Enums\ConversationStatus;
use App\Enums\SenderType;
use App\Events\MessageCreated;
use Database\Factories\ConversationFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

#[Fillable(['brand_id', 'visitor_id', 'status', 'page', 'last_message_preview', 'last_message_at'])]
class Conversation extends Model
{
    /** @use HasFactory<ConversationFactory> */
    use HasFactory, HasUuids;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'status' => ConversationStatus::class,
            'last_message_at' => 'datetime',
            'agent_last_read_message_id' => 'integer',
            'visitor_last_read_message_id' => 'integer',
        ];
    }

    /**
     * @return BelongsTo<Brand, $this>
     */
    public function brand(): BelongsTo
    {
        return $this->belongsTo(Brand::class);
    }

    /**
     * @return BelongsTo<Visitor, $this>
     */
    public function visitor(): BelongsTo
    {
        return $this->belongsTo(Visitor::class);
    }

    /**
     * @return HasMany<Message, $this>
     */
    public function messages(): HasMany
    {
        return $this->hasMany(Message::class);
    }

    /**
     * Add an `unread_count` attribute relative to the given reader's read cursor.
     *
     * @param  Builder<self>  $query
     */
    public function scopeWithUnreadCountFor(Builder $query, User|Visitor $reader): void
    {
        $cursorColumn = $reader instanceof Visitor ? 'visitor_last_read_message_id' : 'agent_last_read_message_id';

        $query->withCount(['messages as unread_count' => function (Builder $messages) use ($reader, $cursorColumn): void {
            if ($reader instanceof Visitor) {
                $messages->where('sender_type', '!=', SenderType::Visitor->value);
            } else {
                $messages->where('sender_type', SenderType::Visitor->value);
            }

            $messages->whereRaw('messages.id > coalesce(conversations.'.$cursorColumn.', 0)');
        }]);
    }

    /**
     * Store a message with server-assigned sender identity. Retrying with the
     * same client message ID returns the original message instead of a copy.
     *
     * @return array{0: Message, 1: bool} The message and whether it was newly created.
     *
     * @throws ValidationException When the client message ID belongs to another sender.
     */
    public function recordMessage(User|Visitor $sender, string $clientMessageId, string $body): array
    {
        $clientMessageId = Str::lower($clientMessageId);

        $existing = $this->findMessageByClientId($clientMessageId);

        if ($existing === null) {
            try {
                $message = DB::transaction(fn (): Message => $this->createMessage($sender, $clientMessageId, $body));

                MessageCreated::dispatch($message);

                return [$message, true];
            } catch (UniqueConstraintViolationException) {
                $existing = $this->findMessageByClientId($clientMessageId);
            }
        }

        if ($existing === null || ! $existing->wasSentBy($sender)) {
            throw ValidationException::withMessages([
                'client_message_id' => 'This client message ID has already been used.',
            ]);
        }

        return [$existing, false];
    }

    /**
     * Advance the reader's cursor; it never moves backwards and only touches this conversation.
     */
    public function markReadBy(User|Visitor $reader, Message $message): void
    {
        $cursorColumn = $reader instanceof Visitor ? 'visitor_last_read_message_id' : 'agent_last_read_message_id';

        static::query()
            ->whereKey($this->getKey())
            ->where(function (Builder $query) use ($cursorColumn, $message): void {
                $query->whereNull($cursorColumn)->orWhere($cursorColumn, '<', $message->getKey());
            })
            ->update([$cursorColumn => $message->getKey()]);

        $this->refresh();
    }

    protected function findMessageByClientId(string $clientMessageId): ?Message
    {
        return $this->messages()->where('client_message_id', $clientMessageId)->first();
    }

    protected function createMessage(User|Visitor $sender, string $clientMessageId, string $body): Message
    {
        $isVisitor = $sender instanceof Visitor;

        $message = $this->messages()->create([
            'client_message_id' => $clientMessageId,
            'sender_type' => $isVisitor ? SenderType::Visitor : SenderType::Agent,
            'sender_user_id' => $isVisitor ? null : $sender->getKey(),
            'sender_visitor_id' => $isVisitor ? $sender->getKey() : null,
            'body' => $body,
        ]);

        $this->forceFill([
            'last_message_preview' => Str::limit($body, 250),
            'last_message_at' => $message->created_at,
            'status' => $isVisitor && $this->status === ConversationStatus::Closed
                ? ConversationStatus::Open
                : $this->status,
        ]);

        if ($isVisitor) {
            $this->visitor_last_read_message_id = $message->getKey();
        } else {
            $this->agent_last_read_message_id = $message->getKey();
        }

        $this->save();

        return $message->setRelation('conversation', $this);
    }
}
