<?php

namespace App\Http\Requests\Api\V1;

use App\Models\Brand;
use App\Models\SavedReply;
use App\Support\SavedReplyShortcut;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

class UpdateSavedReplyRequest extends FormRequest
{
    public function authorize(): bool
    {
        /** @var SavedReply $reply */
        $reply = $this->route('saved_reply');

        return $this->user()?->can('update', $reply) ?? false;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'title' => ['sometimes', 'string', 'max:120'],
            'shortcut' => ['sometimes', 'string', 'max:40'],
            'body' => ['sometimes', 'string', 'max:5000'],
            'brand_id' => ['sometimes', 'nullable', 'integer'],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            if ($validator->errors()->isNotEmpty()) {
                return;
            }

            /** @var SavedReply $reply */
            $reply = $this->route('saved_reply');
            $user = $this->user();
            $orgId = (int) $reply->organization_id;

            $shortcut = $reply->shortcut;
            if ($this->filled('shortcut')) {
                try {
                    $shortcut = SavedReplyShortcut::normalize((string) $this->input('shortcut'));
                } catch (\Illuminate\Validation\ValidationException $e) {
                    $validator->errors()->merge($e->errors());

                    return;
                }
                $this->merge(['shortcut' => $shortcut]);
            }

            $brandId = $reply->brand_id;
            if ($this->exists('brand_id')) {
                $brandId = $this->filled('brand_id') ? (int) $this->input('brand_id') : null;
                if ($brandId !== null) {
                    $brand = Brand::query()->find($brandId);
                    if ($brand === null || (int) $brand->organization_id !== $orgId) {
                        $validator->errors()->add('brand_id', 'Brand not found in your organization.');

                        return;
                    }
                    if (! $user?->canAccessBrand($brand)) {
                        $validator->errors()->add('brand_id', 'You do not have access to this brand.');

                        return;
                    }
                }
            }

            $scopeKey = SavedReplyShortcut::scopeKey($brandId !== null ? (int) $brandId : null);
            $exists = SavedReply::query()
                ->where('organization_id', $orgId)
                ->where('scope_key', $scopeKey)
                ->where('shortcut', $shortcut)
                ->whereNull('archived_at')
                ->whereKeyNot($reply->getKey())
                ->exists();

            if ($exists) {
                $validator->errors()->add('shortcut', 'This shortcut is already used in this scope.');
            }
        });
    }
}
