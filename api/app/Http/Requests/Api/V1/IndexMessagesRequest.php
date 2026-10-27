<?php

namespace App\Http\Requests\Api\V1;

use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

/**
 * Shared by the dashboard and widget; the active guard decides who the actor is.
 */
class IndexMessagesRequest extends FormRequest
{
    public function authorize(): bool
    {
        return Gate::forUser($this->user())->allows('view', $this->route('conversation'));
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'after_id' => ['nullable', 'integer', 'min:0'],
            'cursor' => ['nullable', 'string', 'max:512'],
        ];
    }
}
