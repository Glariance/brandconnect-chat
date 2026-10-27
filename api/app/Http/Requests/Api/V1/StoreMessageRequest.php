<?php

namespace App\Http\Requests\Api\V1;

use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

/**
 * Sender identity always comes from the authenticated guard; any
 * sender_type / sender_*_id fields in the payload are ignored.
 */
class StoreMessageRequest extends FormRequest
{
    public function authorize(): bool
    {
        return Gate::forUser($this->user())->allows('reply', $this->route('conversation'));
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'client_message_id' => ['required', 'string', 'uuid'],
            'text' => ['required', 'string', 'max:'.config('brandconnect.message_max_length')],
        ];
    }
}
