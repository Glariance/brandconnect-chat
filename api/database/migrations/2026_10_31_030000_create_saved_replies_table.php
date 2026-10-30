<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('saved_replies', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            /** Null brand_id = organization-wide default. */
            $table->foreignId('brand_id')->nullable()->constrained()->nullOnDelete();
            /** org | brand:{id} — uniqueness scope (avoids MySQL NULL unique quirks). */
            $table->string('scope_key', 64);
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('title', 120);
            /** Normalized lowercase shortcut including leading slash, e.g. /hello */
            $table->string('shortcut', 40);
            $table->text('body');
            $table->boolean('is_active')->default(true);
            $table->timestamp('archived_at')->nullable();
            $table->timestamps();

            /** archived_at is part of the key so an archived shortcut can be recreated; active duplicates are rejected by request validation. */
            $table->unique(['organization_id', 'scope_key', 'shortcut', 'archived_at'], 'saved_replies_scope_shortcut_archived_unique');
            $table->index(['organization_id', 'is_active', 'archived_at']);
            $table->index(['brand_id', 'is_active']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('saved_replies');
    }
};
