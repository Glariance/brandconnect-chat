<?php

namespace Tests\Feature;

use App\Enums\Role;
use App\Models\Brand;
use App\Models\Organization;
use App\Models\SavedReply;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class SavedReplyTest extends TestCase
{
    use RefreshDatabase;

    public function test_owner_can_create_an_org_wide_reply(): void
    {
        $organization = Organization::factory()->create();
        $owner = $this->createMember($organization, Role::Owner);

        $this->actingAs($owner)
            ->postJson('/api/v1/saved-replies', [
                'title' => 'Greeting',
                'shortcut' => 'Hello',
                'body' => 'Hi there!',
            ])
            ->assertCreated()
            ->assertJsonPath('data.shortcut', '/hello')
            ->assertJsonPath('data.scope', 'organization')
            ->assertJsonPath('data.brand_id', null);

        $this->assertDatabaseHas('saved_replies', [
            'organization_id' => $organization->id,
            'brand_id' => null,
            'scope_key' => 'org',
            'shortcut' => '/hello',
            'created_by' => $owner->id,
        ]);
    }

    public function test_owner_can_create_a_brand_scoped_reply(): void
    {
        $brand = Brand::factory()->create();
        $owner = $this->createMember($brand->organization, Role::Owner);

        $this->actingAs($owner)
            ->postJson('/api/v1/saved-replies', [
                'title' => 'Greeting',
                'shortcut' => '/hello',
                'body' => 'Hi from the brand',
                'brand_id' => $brand->id,
            ])
            ->assertCreated()
            ->assertJsonPath('data.scope', 'brand')
            ->assertJsonPath('data.brand_id', $brand->id);

        $this->assertDatabaseHas('saved_replies', [
            'organization_id' => $brand->organization_id,
            'brand_id' => $brand->id,
            'scope_key' => 'brand:'.$brand->id,
            'shortcut' => '/hello',
        ]);
    }

    public function test_owner_cannot_create_a_reply_for_a_brand_in_another_organization(): void
    {
        $owner = $this->createMember(Organization::factory()->create(), Role::Owner);
        $foreignBrand = Brand::factory()->create();

        $this->actingAs($owner)
            ->postJson('/api/v1/saved-replies', [
                'title' => 'Greeting',
                'shortcut' => '/hello',
                'body' => 'Hi',
                'brand_id' => $foreignBrand->id,
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('brand_id');
    }

    public function test_agent_cannot_create_update_or_delete_replies(): void
    {
        $brand = Brand::factory()->create();
        $agent = $this->createAssignedAgent($brand);
        $reply = SavedReply::factory()->forOrganization($brand->organization)->create(['shortcut' => '/hello']);

        $this->actingAs($agent);

        $this->postJson('/api/v1/saved-replies', [
            'title' => 'Nope',
            'shortcut' => '/nope',
            'body' => 'Nope',
        ])->assertForbidden();

        $this->patchJson("/api/v1/saved-replies/{$reply->id}", ['body' => 'Changed'])->assertForbidden();
        $this->deleteJson("/api/v1/saved-replies/{$reply->id}")->assertForbidden();

        $reply->refresh();
        $this->assertNotSame('Changed', $reply->body);
        $this->assertNull($reply->archived_at);
        $this->assertDatabaseMissing('saved_replies', ['shortcut' => '/nope']);
    }

    public function test_owner_can_update_a_reply(): void
    {
        $organization = Organization::factory()->create();
        $owner = $this->createMember($organization, Role::Owner);
        $reply = SavedReply::factory()->forOrganization($organization)->create(['shortcut' => '/hello']);

        $this->actingAs($owner)
            ->patchJson("/api/v1/saved-replies/{$reply->id}", ['body' => 'Updated body', 'shortcut' => 'Bye'])
            ->assertOk()
            ->assertJsonPath('data.body', 'Updated body')
            ->assertJsonPath('data.shortcut', '/bye');

        $this->assertSame('/bye', $reply->fresh()->shortcut);
    }

    public function test_agent_can_list_composer_replies_for_an_accessible_brand(): void
    {
        $brand = Brand::factory()->create();
        $agent = $this->createAssignedAgent($brand);
        SavedReply::factory()->forOrganization($brand->organization)->create(['shortcut' => '/org', 'body' => 'Org body']);
        SavedReply::factory()->forBrand($brand)->create(['shortcut' => '/brand', 'body' => 'Brand body']);

        $otherBrand = Brand::factory()->for($brand->organization)->create();
        SavedReply::factory()->forBrand($otherBrand)->create(['shortcut' => '/other']);

        $this->actingAs($agent)
            ->getJson("/api/v1/saved-replies?composer=1&brand_id={$brand->id}")
            ->assertOk()
            ->assertJsonCount(2, 'data')
            ->assertJsonPath('data.0.shortcut', '/brand')
            ->assertJsonPath('data.1.shortcut', '/org');
    }

    public function test_agent_cannot_list_composer_replies_for_an_unassigned_brand(): void
    {
        $brand = Brand::factory()->create();
        $otherBrand = Brand::factory()->for($brand->organization)->create();
        $agent = $this->createAssignedAgent($brand);

        $this->actingAs($agent)
            ->getJson("/api/v1/saved-replies?composer=1&brand_id={$otherBrand->id}")
            ->assertForbidden();
    }

    public function test_brand_specific_shortcut_overrides_org_wide_in_composer_list(): void
    {
        $brand = Brand::factory()->create();
        $agent = $this->createAssignedAgent($brand);
        SavedReply::factory()->forOrganization($brand->organization)->create(['shortcut' => '/hello', 'body' => 'Org body']);
        SavedReply::factory()->forBrand($brand)->create(['shortcut' => '/hello', 'body' => 'Brand body']);

        $this->actingAs($agent)
            ->getJson("/api/v1/saved-replies?composer=1&brand_id={$brand->id}")
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.shortcut', '/hello')
            ->assertJsonPath('data.0.body', 'Brand body')
            ->assertJsonPath('data.0.brand_id', $brand->id);
    }

    public function test_org_wide_reply_is_used_for_brands_without_an_override(): void
    {
        $brand = Brand::factory()->create();
        $otherBrand = Brand::factory()->for($brand->organization)->create();
        $owner = $this->createMember($brand->organization, Role::Owner);
        SavedReply::factory()->forOrganization($brand->organization)->create(['shortcut' => '/hello', 'body' => 'Org body']);
        SavedReply::factory()->forBrand($brand)->create(['shortcut' => '/hello', 'body' => 'Brand body']);

        $this->actingAs($owner)
            ->getJson("/api/v1/saved-replies?composer=1&brand_id={$otherBrand->id}")
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.body', 'Org body');
    }

    public function test_invalid_shortcut_is_rejected(): void
    {
        $organization = Organization::factory()->create();
        $owner = $this->createMember($organization, Role::Owner);

        $this->actingAs($owner);

        $invalid = ['/has space', '/bad!char', '//double', '/', '/'.str_repeat('a', 33), '/-leading'];

        foreach ($invalid as $shortcut) {
            $this->postJson('/api/v1/saved-replies', [
                'title' => 'Bad',
                'shortcut' => $shortcut,
                'body' => 'Body',
            ])
                ->assertUnprocessable()
                ->assertJsonValidationErrors('shortcut');
        }

        $this->assertDatabaseCount('saved_replies', 0);
    }

    public function test_duplicate_shortcut_in_same_scope_is_rejected(): void
    {
        $brand = Brand::factory()->create();
        $owner = $this->createMember($brand->organization, Role::Owner);
        SavedReply::factory()->forOrganization($brand->organization)->create(['shortcut' => '/hello']);
        SavedReply::factory()->forBrand($brand)->create(['shortcut' => '/brand']);

        $this->actingAs($owner);

        $this->postJson('/api/v1/saved-replies', ['title' => 'Dup', 'shortcut' => 'HELLO', 'body' => 'Body'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('shortcut');

        $this->postJson('/api/v1/saved-replies', [
            'title' => 'Dup',
            'shortcut' => '/brand',
            'body' => 'Body',
            'brand_id' => $brand->id,
        ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('shortcut');

        $this->assertSame(2, SavedReply::query()->count());
    }

    public function test_updating_to_a_duplicate_shortcut_in_same_scope_is_rejected(): void
    {
        $organization = Organization::factory()->create();
        $owner = $this->createMember($organization, Role::Owner);
        SavedReply::factory()->forOrganization($organization)->create(['shortcut' => '/one']);
        $second = SavedReply::factory()->forOrganization($organization)->create(['shortcut' => '/two']);

        $this->actingAs($owner)
            ->patchJson("/api/v1/saved-replies/{$second->id}", ['shortcut' => '/one'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('shortcut');
    }

    public function test_same_shortcut_is_allowed_across_org_and_brand_scopes(): void
    {
        $brand = Brand::factory()->create();
        $owner = $this->createMember($brand->organization, Role::Owner);

        $this->actingAs($owner);

        $this->postJson('/api/v1/saved-replies', ['title' => 'Org', 'shortcut' => '/hello', 'body' => 'Org'])
            ->assertCreated();
        $this->postJson('/api/v1/saved-replies', [
            'title' => 'Brand',
            'shortcut' => '/hello',
            'body' => 'Brand',
            'brand_id' => $brand->id,
        ])->assertCreated();

        $this->assertSame(2, SavedReply::query()->where('shortcut', '/hello')->count());
    }

    public function test_same_shortcut_is_allowed_across_two_brands(): void
    {
        $brandA = Brand::factory()->create();
        $brandB = Brand::factory()->for($brandA->organization)->create();
        $owner = $this->createMember($brandA->organization, Role::Owner);

        $this->actingAs($owner);

        foreach ([$brandA, $brandB] as $brand) {
            $this->postJson('/api/v1/saved-replies', [
                'title' => 'Hello',
                'shortcut' => '/hello',
                'body' => 'Body',
                'brand_id' => $brand->id,
            ])->assertCreated();
        }

        $this->assertDatabaseHas('saved_replies', ['scope_key' => 'brand:'.$brandA->id, 'shortcut' => '/hello']);
        $this->assertDatabaseHas('saved_replies', ['scope_key' => 'brand:'.$brandB->id, 'shortcut' => '/hello']);
    }

    public function test_archive_sets_archived_at_excludes_from_composer_and_frees_the_shortcut(): void
    {
        $brand = Brand::factory()->create();
        $owner = $this->createMember($brand->organization, Role::Owner);
        $reply = SavedReply::factory()->forOrganization($brand->organization)->create(['shortcut' => '/hello']);

        $this->actingAs($owner);

        $this->deleteJson("/api/v1/saved-replies/{$reply->id}")->assertOk();

        $reply->refresh();
        $this->assertNotNull($reply->archived_at);
        $this->assertFalse($reply->is_active);

        $this->getJson("/api/v1/saved-replies?composer=1&brand_id={$brand->id}")
            ->assertOk()
            ->assertJsonCount(0, 'data');

        $this->postJson('/api/v1/saved-replies', ['title' => 'Again', 'shortcut' => '/hello', 'body' => 'New'])
            ->assertCreated();

        $this->assertSame(2, SavedReply::query()->where('shortcut', '/hello')->count());

        $this->getJson("/api/v1/saved-replies?composer=1&brand_id={$brand->id}")
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.body', 'New');
    }

    public function test_archived_replies_are_hidden_from_management_list_unless_requested(): void
    {
        $organization = Organization::factory()->create();
        $owner = $this->createMember($organization, Role::Owner);
        SavedReply::factory()->forOrganization($organization)->create(['shortcut' => '/live']);
        SavedReply::factory()->forOrganization($organization)->archived()->create(['shortcut' => '/gone']);

        $this->actingAs($owner);

        $this->getJson('/api/v1/saved-replies')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.shortcut', '/live');

        $this->getJson('/api/v1/saved-replies?include_archived=1')
            ->assertOk()
            ->assertJsonCount(2, 'data');
    }

    public function test_other_organization_owner_cannot_see_or_modify_replies(): void
    {
        $organization = Organization::factory()->create();
        $reply = SavedReply::factory()->forOrganization($organization)->create(['shortcut' => '/secret', 'body' => 'Private']);

        $otherOwner = $this->createMember(Organization::factory()->create(), Role::Owner);

        $this->actingAs($otherOwner);

        $this->getJson('/api/v1/saved-replies?include_archived=1')
            ->assertOk()
            ->assertJsonCount(0, 'data');

        $this->patchJson("/api/v1/saved-replies/{$reply->id}", ['body' => 'Hacked'])->assertForbidden();
        $this->deleteJson("/api/v1/saved-replies/{$reply->id}")->assertForbidden();

        $reply->refresh();
        $this->assertSame('Private', $reply->body);
        $this->assertNull($reply->archived_at);
    }

    public function test_other_organization_owner_cannot_use_composer_for_a_foreign_brand(): void
    {
        $brand = Brand::factory()->create();
        SavedReply::factory()->forOrganization($brand->organization)->create(['shortcut' => '/secret']);
        $otherOwner = $this->createMember(Organization::factory()->create(), Role::Owner);

        $this->actingAs($otherOwner)
            ->getJson("/api/v1/saved-replies?composer=1&brand_id={$brand->id}")
            ->assertForbidden();
    }

    public function test_inactive_replies_are_excluded_from_composer(): void
    {
        $brand = Brand::factory()->create();
        $agent = $this->createAssignedAgent($brand);
        SavedReply::factory()->forOrganization($brand->organization)->inactive()->create(['shortcut' => '/off']);
        SavedReply::factory()->forBrand($brand)->inactive()->create(['shortcut' => '/brandoff']);
        SavedReply::factory()->forOrganization($brand->organization)->create(['shortcut' => '/on']);

        $this->actingAs($agent)
            ->getJson("/api/v1/saved-replies?composer=1&brand_id={$brand->id}")
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.shortcut', '/on');
    }

    public function test_inactive_brand_reply_does_not_override_active_org_reply(): void
    {
        $brand = Brand::factory()->create();
        $agent = $this->createAssignedAgent($brand);
        SavedReply::factory()->forOrganization($brand->organization)->create(['shortcut' => '/hello', 'body' => 'Org body']);
        SavedReply::factory()->forBrand($brand)->inactive()->create(['shortcut' => '/hello', 'body' => 'Brand body']);

        $this->actingAs($agent)
            ->getJson("/api/v1/saved-replies?composer=1&brand_id={$brand->id}")
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.body', 'Org body');
    }
}
