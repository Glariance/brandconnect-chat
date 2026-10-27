<?php

namespace Tests\Feature;

use App\Enums\Role;
use App\Models\Brand;
use App\Models\Organization;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class BrandTest extends TestCase
{
    use RefreshDatabase;

    public function test_owner_only_sees_brands_of_their_own_organization(): void
    {
        $organization = Organization::factory()->create();
        $owner = $this->createMember($organization, Role::Owner);
        $ownBrand = Brand::factory()->for($organization)->create(['name' => 'Alpha']);
        $foreignBrand = Brand::factory()->create(['name' => 'Foreign']);

        $this->actingAs($owner)
            ->getJson('/api/v1/brands')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $ownBrand->id)
            ->assertJsonMissing(['id' => $foreignBrand->id]);
    }

    public function test_agent_only_sees_assigned_brands(): void
    {
        $organization = Organization::factory()->create();
        $assignedBrand = Brand::factory()->for($organization)->create();
        Brand::factory()->for($organization)->create();
        $agent = $this->createAssignedAgent($assignedBrand);

        $this->actingAs($agent)
            ->getJson('/api/v1/brands')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $assignedBrand->id);
    }

    public function test_agent_assignment_in_a_foreign_organization_grants_nothing(): void
    {
        $foreignBrand = Brand::factory()->create();
        $agent = $this->createMember(Organization::factory()->create(), Role::Agent);
        $foreignBrand->agents()->attach($agent);

        $this->actingAs($agent)
            ->getJson('/api/v1/brands')
            ->assertOk()
            ->assertJsonCount(0, 'data');
    }

    public function test_owner_creates_brand_in_their_own_organization_ignoring_payload_organization(): void
    {
        $organization = Organization::factory()->create();
        $otherOrganization = Organization::factory()->create();
        $owner = $this->createMember($organization, Role::Owner);

        $response = $this->actingAs($owner)
            ->postJson('/api/v1/brands', [
                'name' => 'New Brand',
                'domain' => 'example.com',
                'timezone' => 'Asia/Karachi',
                'color' => '#112233',
                'organization_id' => $otherOrganization->id,
            ])
            ->assertCreated()
            ->assertJsonPath('data.name', 'New Brand')
            ->assertJsonPath('data.organization_id', $organization->id)
            ->assertJsonPath('data.timezone', 'Asia/Karachi');

        $this->assertStringStartsWith('brd_', $response->json('data.public_id'));
        $this->assertDatabaseMissing('brands', ['organization_id' => $otherOrganization->id]);
    }

    public function test_brand_creation_validates_input(): void
    {
        $owner = $this->createMember(Organization::factory()->create(), Role::Owner);

        $this->actingAs($owner)
            ->postJson('/api/v1/brands', ['name' => '', 'color' => 'red', 'timezone' => 'Mars/Base'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['name', 'color', 'timezone']);
    }

    public function test_agent_cannot_create_brands(): void
    {
        $agent = $this->createMember(Organization::factory()->create(), Role::Agent);

        $this->actingAs($agent)
            ->postJson('/api/v1/brands', ['name' => 'Nope'])
            ->assertForbidden();
    }

    public function test_public_widget_config_exposes_only_allowlisted_fields(): void
    {
        $brand = Brand::factory()->create([
            'greeting' => 'Hello there',
            'allowed_origins' => ['https://shop.example.com'],
        ]);

        $response = $this->getJson("/api/v1/widget/brands/{$brand->public_id}/config")
            ->assertOk()
            ->assertExactJson(['data' => [
                'public_id' => $brand->public_id,
                'name' => $brand->name,
                'color' => $brand->color,
                'greeting' => 'Hello there',
                'allowed_origins' => ['https://shop.example.com'],
            ]]);

        $this->assertArrayNotHasKey('organization_id', $response->json('data'));
    }

    public function test_widget_config_for_unknown_brand_is_not_found(): void
    {
        $this->getJson('/api/v1/widget/brands/brd_doesnotexist/config')->assertNotFound();
    }
}
