<?php

namespace App\Http\Requests\Api\V1;

use App\Models\Brand;
use App\Rules\ExactOrigin;
use App\Support\OriginAllowlist;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;
use InvalidArgumentException;

class UpdateBrandRequest extends FormRequest
{
    public function authorize(): bool
    {
        /** @var Brand $brand */
        $brand = $this->route('brand');

        return $this->user()->can('update', $brand);
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'name' => ['sometimes', 'string', 'max:120'],
            'domain' => ['sometimes', 'nullable', 'string', 'max:255'],
            'timezone' => ['sometimes', 'nullable', 'timezone:all'],
            'color' => ['sometimes', 'nullable', 'string', 'regex:/^#[0-9a-fA-F]{6}$/'],
            'greeting' => ['sometimes', 'nullable', 'string', 'max:500'],
            'allowed_origins' => ['sometimes', 'nullable', 'array', 'max:20'],
            'allowed_origins.*' => ['string', 'max:255', new ExactOrigin],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            if ($validator->errors()->isNotEmpty()) {
                return;
            }
            if (! $this->exists('allowed_origins')) {
                return;
            }
            try {
                $normalized = OriginAllowlist::normalizeList(
                    $this->input('allowed_origins') ?? [],
                    (bool) config('widget.allow_localhost_origins', false),
                );
                $this->merge(['allowed_origins' => $normalized]);
            } catch (InvalidArgumentException $e) {
                $validator->errors()->add('allowed_origins', $e->getMessage());
            }
        });
    }
}
