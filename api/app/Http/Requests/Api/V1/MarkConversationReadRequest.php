<?php

namespace App\Http\Requests\Api\V1;

use App\Models\Conversation;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

class MarkConversationReadRequest extends FormRequest
{
    public function authorize(): bool
    {
        return Gate::forUser($this->user())->allows('view', $this->route('conversation'));
    }

    /**
     * The message must belong to this conversation, so a read can never
     * advance the cursor of another conversation.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        /** @var Conversation $conversation */
        $conversation = $this->route('conversation');

        return [
            'message_id' => [
                'required',
                'integer',
                Rule::exists('messages', 'id')->where('conversation_id', $conversation->getKey()),
            ],
        ];
    }
}
