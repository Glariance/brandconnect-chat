<?php

namespace App\Console\Commands;

use App\Enums\Role;
use App\Models\Brand;
use App\Models\Membership;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;

#[Signature('brandconnect:provision-owner
    {--email= : Owner email address}
    {--name= : Owner display name}
    {--password= : Owner password (prompted securely when omitted)}
    {--organization= : Organization name (defaults to "<name>\'s Organization")}
    {--brand= : Optionally create or reuse a brand with this name}')]
#[Description('Idempotently create or update an organization owner (and optionally a brand)')]
class ProvisionOwner extends Command
{
    /**
     * Execute the console command.
     */
    public function handle(): int
    {
        $email = $this->option('email') ?: $this->ask('Owner email');
        $name = $this->option('name') ?: $this->ask('Owner name', 'Owner');

        $validator = Validator::make(['email' => $email, 'name' => $name], [
            'email' => ['required', 'email', 'max:255'],
            'name' => ['required', 'string', 'max:255'],
        ]);

        if ($validator->fails()) {
            foreach ($validator->errors()->all() as $error) {
                $this->error($error);
            }

            return self::FAILURE;
        }

        $existingUser = User::query()->where('email', $email)->first();
        $password = $this->resolvePassword($existingUser);

        if ($password === false) {
            return self::FAILURE;
        }

        $organizationName = $this->option('organization') ?: $name."'s Organization";
        $brandName = $this->option('brand');

        [$user, $organization, $brand] = DB::transaction(function () use ($existingUser, $email, $name, $password, $organizationName, $brandName): array {
            $user = $existingUser ?? new User(['email' => $email]);
            $user->name = $name;

            if ($password !== null) {
                $user->password = $password;
            }

            $user->save();

            $organization = $user->memberships()->where('role', Role::Owner->value)->first()?->organization
                ?? Organization::query()->firstOrCreate(['name' => $organizationName]);

            Membership::query()->updateOrCreate(
                ['organization_id' => $organization->getKey(), 'user_id' => $user->getKey()],
                ['role' => Role::Owner],
            );

            $brand = null;

            if (filled($brandName)) {
                $brand = $organization->brands()->firstOrCreate(['name' => $brandName], [
                    'public_id' => Brand::generatePublicId(),
                    'timezone' => 'UTC',
                    'color' => '#4f46e5',
                    'greeting' => 'Hi! How can we help?',
                    'allowed_origins' => [],
                ]);

                $brand->agents()->syncWithoutDetaching([$user->getKey()]);
            }

            return [$user, $organization, $brand];
        });

        $this->info(($existingUser ? 'Updated' : 'Created')." owner {$user->email} in organization \"{$organization->name}\" (#{$organization->id}).");

        if ($brand !== null) {
            $this->info("Brand \"{$brand->name}\" public ID: {$brand->public_id}");
        }

        return self::SUCCESS;
    }

    /**
     * @return string|false|null The new password, false on failure, or null to keep the existing one.
     */
    protected function resolvePassword(?User $existingUser): string|false|null
    {
        $password = $this->option('password');

        if (blank($password)) {
            if ($existingUser !== null) {
                return null;
            }

            if (! $this->input->isInteractive()) {
                $this->error('A password is required for a new owner. Pass --password or run interactively.');

                return false;
            }

            $password = $this->secret('Owner password (min 12 characters)');
            $confirmation = $this->secret('Confirm password');

            if ($password !== $confirmation) {
                $this->error('Passwords do not match.');

                return false;
            }
        }

        if (mb_strlen((string) $password) < 12) {
            $this->error('The password must be at least 12 characters.');

            return false;
        }

        return $password;
    }
}
