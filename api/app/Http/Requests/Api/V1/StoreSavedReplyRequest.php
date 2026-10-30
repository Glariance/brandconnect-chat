<?php

namespace App\Http\Requests\Api\V1;

use App\Models\Brand;
use App\Models\SavedReply;
use App\Support\SavedReplyShortcut;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class StoreSavedReplyRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->can('create', SavedReply::class) ?? false;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'title' => ['required', 'string', 'max:120'],
            'shortcut' => ['required', 'string', 'max:40'],
            'body' => ['required', 'string', 'max:5000'],
            'brand_id' => ['nullable', 'integer'],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            if ($validator->errors()->isNotEmpty()) {
                return;
            }

            try {
                $shortcut = SavedReplyShortcut::normalize((string) $this->input('shortcut'));
            } catch (\Illuminate\Validation\ValidationException $e) {
                $validator->errors()->merge($e->errors());

                return;
            }

            $this->merge(['shortcut' => $shortcut]);

            $user = $this->user();
            $orgId = $user?->primaryMembership?->organization_id;
            if ($orgId === null) {
                $validator->errors()->add('organization', 'No organization membership.');

                return;
            }

            $brandId = $this->filled('brand_id') ? (int) $this->input('brand_id') : null;
            if ($brandId !== null) {
                $brand = Brand::query()->find($brandId);
                if ($brand === null || (int) $brand->organization_id !== (int) $orgId) {
                    $validator->errors()->add('brand_id', 'Brand not found in your organization.');

                    return;
                }
                if (! $user->canAccessBrand($brand)) {
                    $validator->errors()->add('brand_id', 'You do not have access to this brand.');

                    return;
                }
            }

            $scopeKey = SavedReplyShortcut::scopeKey($brandId);
            $exists = SavedReply::query()
                ->where('organization_id', $orgId)
                ->where('scope_key', $scopeKey)
                ->where('shortcut', $shortcut)
                ->whereNull('archived_at')
                ->exists();

            if ($exists) {
                $validator->errors()->add('shortcut', 'This shortcut is already used in this scope.');
            }
        });
    }
}
