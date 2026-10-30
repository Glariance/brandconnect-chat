<?php

namespace App\Http\Requests\Api\V1;

use App\Models\Brand;
use App\Rules\ExactOrigin;
use App\Support\OriginAllowlist;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;
use InvalidArgumentException;

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
            'allowed_origins.*' => ['string', 'max:255', new ExactOrigin],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            if ($validator->errors()->isNotEmpty() || ! $this->exists('allowed_origins')) {
                return;
            }
            try {
                $this->merge([
                    'allowed_origins' => OriginAllowlist::normalizeList(
                        $this->input('allowed_origins') ?? [],
                        (bool) config('widget.allow_localhost_origins', false),
                    ),
                ]);
            } catch (InvalidArgumentException $e) {
                $validator->errors()->add('allowed_origins', $e->getMessage());
            }
        });
    }
}
