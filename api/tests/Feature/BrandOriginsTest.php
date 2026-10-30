<?php

namespace Tests\Feature;

use App\Enums\Role;
use App\Models\Brand;
use App\Models\Organization;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class BrandOriginsTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config([
            'widget.preview_origins' => ['http://localhost:8080', 'http://127.0.0.1:8080'],
            'widget.allow_localhost_origins' => false,
        ]);
    }

    public function test_owner_can_update_allowed_origins(): void
    {
        $organization = Organization::factory()->create();
        $owner = $this->createMember($organization, Role::Owner);
        $brand = Brand::factory()->for($organization)->create(['allowed_origins' => []]);

        $this->actingAs($owner)
            ->patchJson("/api/v1/brands/{$brand->id}", [
                'allowed_origins' => [
                    'https://Shop.Example.com/',
                    'https://www.example.com',
                ],
            ])
            ->assertOk()
            ->assertJsonPath('data.allowed_origins', [
                'https://shop.example.com',
                'https://www.example.com',
            ]);
    }

    public function test_agent_cannot_update_allowed_origins(): void
    {
        $organization = Organization::factory()->create();
        $brand = Brand::factory()->for($organization)->create();
        $agent = $this->createAssignedAgent($brand);

        $this->actingAs($agent)
            ->patchJson("/api/v1/brands/{$brand->id}", [
                'allowed_origins' => ['https://shop.example.com'],
            ])
            ->assertForbidden();
    }

    public function test_rejects_wildcard_and_path_origins(): void
    {
        $organization = Organization::factory()->create();
        $owner = $this->createMember($organization, Role::Owner);
        $brand = Brand::factory()->for($organization)->create();

        $this->actingAs($owner)
            ->patchJson("/api/v1/brands/{$brand->id}", [
                'allowed_origins' => ['https://*.example.com'],
            ])
            ->assertUnprocessable();

        $this->actingAs($owner)
            ->patchJson("/api/v1/brands/{$brand->id}", [
                'allowed_origins' => ['https://example.com/path'],
            ])
            ->assertUnprocessable();
    }

    public function test_rejects_localhost_http_without_dev_flag(): void
    {
        $organization = Organization::factory()->create();
        $owner = $this->createMember($organization, Role::Owner);
        $brand = Brand::factory()->for($organization)->create();

        $this->actingAs($owner)
            ->patchJson("/api/v1/brands/{$brand->id}", [
                'allowed_origins' => ['http://localhost:3000'],
            ])
            ->assertUnprocessable();
    }

    public function test_widget_config_includes_frame_ancestors_with_preview(): void
    {
        $brand = Brand::factory()->create([
            'allowed_origins' => ['https://shop.example.com'],
        ]);

        $this->getJson("/api/v1/widget/brands/{$brand->public_id}/config")
            ->assertOk()
            ->assertJsonPath('data.allowed_origins', ['https://shop.example.com'])
            ->assertJsonPath('data.frame_ancestors', [
                'https://shop.example.com',
                'http://localhost:8080',
                'http://127.0.0.1:8080',
            ]);
    }

    public function test_brand_a_origins_do_not_appear_on_brand_b_config(): void
    {
        $brandA = Brand::factory()->create([
            'allowed_origins' => ['https://a.example.com'],
        ]);
        $brandB = Brand::factory()->create([
            'allowed_origins' => ['https://b.example.com'],
        ]);

        $this->getJson("/api/v1/widget/brands/{$brandB->public_id}/config")
            ->assertOk()
            ->assertJsonPath('data.allowed_origins', ['https://b.example.com'])
            ->assertJsonMissing(['https://a.example.com']);

        $this->getJson("/api/v1/widget/brands/{$brandA->public_id}/config")
            ->assertOk()
            ->assertJsonMissing(['https://b.example.com']);
    }
}
