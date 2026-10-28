<?php

namespace App\Http\Requests\Api\V1\Widget;

use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

class UpsertVisitorPresenceRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'tab_id' => ['required', 'uuid'],
            'page' => ['nullable', 'string', 'max:2000'],
            'chat_opened' => ['sometimes', 'boolean'],
            'activity' => ['sometimes', 'boolean'],
        ];
    }
}
