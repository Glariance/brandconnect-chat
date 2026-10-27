<?php

namespace App\Http\Requests\Api\V1;

use App\Enums\ConversationStatus;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class IndexConversationsRequest extends FormRequest
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
            'brand_id' => ['nullable', 'integer'],
            'status' => ['nullable', Rule::enum(ConversationStatus::class)],
            'cursor' => ['nullable', 'string', 'max:512'],
        ];
    }
}
