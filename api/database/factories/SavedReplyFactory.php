<?php

namespace Database\Factories;

use App\Models\Brand;
use App\Models\Organization;
use App\Models\SavedReply;
use App\Models\User;
use App\Support\SavedReplyShortcut;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<SavedReply>
 */
class SavedReplyFactory extends Factory
{
    protected $model = SavedReply::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $organization = Organization::factory()->create();
        $shortcut = '/'.fake()->unique()->lexify('????');

        return [
            'organization_id' => $organization->id,
            'brand_id' => null,
            'scope_key' => SavedReplyShortcut::scopeKey(null),
            'created_by' => null,
            'title' => fake()->sentence(3),
            'shortcut' => $shortcut,
            'body' => fake()->paragraph(),
            'is_active' => true,
            'archived_at' => null,
        ];
    }

    public function forOrganization(Organization $organization): static
    {
        return $this->state(fn (): array => [
            'organization_id' => $organization->id,
            'brand_id' => null,
            'scope_key' => SavedReplyShortcut::scopeKey(null),
        ]);
    }

    public function forBrand(Brand $brand): static
    {
        return $this->state(fn (): array => [
            'organization_id' => $brand->organization_id,
            'brand_id' => $brand->id,
            'scope_key' => SavedReplyShortcut::scopeKey($brand->id),
        ]);
    }

    public function createdBy(User $user): static
    {
        return $this->state(fn (): array => ['created_by' => $user->id]);
    }

    public function archived(): static
    {
        return $this->state(fn (): array => [
            'is_active' => false,
            'archived_at' => now(),
        ]);
    }

    public function inactive(): static
    {
        return $this->state(fn (): array => ['is_active' => false]);
    }
}
