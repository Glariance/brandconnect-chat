<?php

namespace Tests\Feature;

use App\Enums\Role;
use App\Models\Brand;
use App\Models\Membership;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class ProvisionOwnerCommandTest extends TestCase
{
    use RefreshDatabase;

    public function test_it_provisions_owner_organization_and_brand_idempotently(): void
    {
        $arguments = [
            '--email' => 'owner@example.com',
            '--name' => 'Olivia Owner',
            '--password' => 'correct-horse-battery',
            '--organization' => 'Acme',
            '--brand' => 'Acme Store',
        ];

        $this->artisan('brandconnect:provision-owner', $arguments)->assertSuccessful();
        $this->artisan('brandconnect:provision-owner', $arguments)->assertSuccessful();

        $user = User::query()->sole();
        $this->assertTrue(Hash::check('correct-horse-battery', $user->password));
        $this->assertSame(1, Organization::query()->count());
        $this->assertSame(1, Brand::query()->count());
        $this->assertSame(Role::Owner, Membership::query()->sole()->role);
        $this->assertTrue($user->canAccessBrand(Brand::query()->sole()));
    }

    public function test_it_keeps_the_existing_password_when_none_is_given(): void
    {
        $this->artisan('brandconnect:provision-owner', [
            '--email' => 'owner@example.com',
            '--name' => 'Owner',
            '--password' => 'original-password-1',
        ])->assertSuccessful();

        $this->artisan('brandconnect:provision-owner', [
            '--email' => 'owner@example.com',
            '--name' => 'Renamed Owner',
            '--no-interaction' => true,
        ])->assertSuccessful();

        $user = User::query()->sole();
        $this->assertSame('Renamed Owner', $user->name);
        $this->assertTrue(Hash::check('original-password-1', $user->password));
    }

    public function test_it_prompts_for_a_password_when_interactive(): void
    {
        $this->artisan('brandconnect:provision-owner', ['--email' => 'new@example.com', '--name' => 'New'])
            ->expectsQuestion('Owner password (min 12 characters)', 'prompted-password-1')
            ->expectsQuestion('Confirm password', 'prompted-password-1')
            ->assertSuccessful();

        $this->assertTrue(Hash::check('prompted-password-1', User::query()->sole()->password));
    }

    public function test_it_fails_without_a_password_for_a_new_owner_when_non_interactive(): void
    {
        $this->artisan('brandconnect:provision-owner', [
            '--email' => 'new@example.com',
            '--name' => 'New',
            '--no-interaction' => true,
        ])->assertFailed();

        $this->assertSame(0, User::query()->count());
    }

    public function test_it_rejects_short_passwords(): void
    {
        $this->artisan('brandconnect:provision-owner', [
            '--email' => 'new@example.com',
            '--name' => 'New',
            '--password' => 'short',
        ])->assertFailed();

        $this->assertSame(0, User::query()->count());
    }
}
