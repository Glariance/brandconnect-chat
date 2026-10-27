<?php

namespace Database\Factories;

use App\Models\Brand;
use App\Models\Organization;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Brand>
 */
class BrandFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'organization_id' => Organization::factory(),
            'name' => fake()->company(),
            'domain' => fake()->domainName(),
            'timezone' => 'UTC',
            'color' => fake()->hexColor(),
            'public_id' => Brand::generatePublicId(),
            'allowed_origins' => [],
            'greeting' => 'Hi! How can we help?',
        ];
    }
}
