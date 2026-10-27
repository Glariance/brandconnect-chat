<?php

namespace Database\Factories;

use App\Enums\ConversationStatus;
use App\Models\Brand;
use App\Models\Conversation;
use App\Models\Visitor;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Conversation>
 */
class ConversationFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'brand_id' => Brand::factory(),
            'visitor_id' => fn (array $attributes) => Visitor::factory()->create(['brand_id' => $attributes['brand_id']]),
            'status' => ConversationStatus::Open,
            'page' => '/'.fake()->slug(2),
            'last_message_at' => now(),
        ];
    }

    public function forVisitor(Visitor $visitor): static
    {
        return $this->state(fn (array $attributes) => [
            'brand_id' => $visitor->brand_id,
            'visitor_id' => $visitor->getKey(),
        ]);
    }

    public function closed(): static
    {
        return $this->state(fn (array $attributes) => ['status' => ConversationStatus::Closed]);
    }
}
