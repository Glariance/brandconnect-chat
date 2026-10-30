<?php

namespace App\Http\Requests\Api\V1;

use Illuminate\Foundation\Http\FormRequest;

class StoreLiveVisitorMessageRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user() !== null;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'client_message_id' => ['required', 'uuid'],
            'text' => ['required', 'string', 'min:1', 'max:5000'],
            'page' => ['sometimes', 'nullable', 'string', 'max:500'],
        ];
    }
}
