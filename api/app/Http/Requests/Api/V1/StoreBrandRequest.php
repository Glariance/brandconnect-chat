<?php

namespace App\Http\Requests\Api\V1;

use App\Models\Brand;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

class StoreBrandRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->can('create', Brand::class);
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:120'],
            'domain' => ['nullable', 'string', 'max:255'],
            'timezone' => ['nullable', 'timezone:all'],
            'color' => ['nullable', 'string', 'regex:/^#[0-9a-fA-F]{6}$/'],
            'greeting' => ['nullable', 'string', 'max:500'],
            'allowed_origins' => ['nullable', 'array', 'max:20'],
            'allowed_origins.*' => ['string', 'url:http,https', 'max:255'],
        ];
    }
}
