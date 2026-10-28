<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('visitor_presences', function (Blueprint $table) {
            $table->id();
            $table->foreignId('visitor_id')->constrained()->cascadeOnDelete();
            $table->foreignId('brand_id')->constrained()->cascadeOnDelete();
            /** Client-generated per-tab id; multiple tabs share one visitor. */
            $table->uuid('tab_id');
            $table->string('page', 500)->default('/');
            $table->timestamp('first_seen_at');
            $table->timestamp('last_seen_at');
            $table->timestamp('last_activity_at');
            $table->boolean('chat_opened')->default(false);
            $table->timestamps();

            $table->unique(['visitor_id', 'tab_id']);
            $table->index(['brand_id', 'last_seen_at']);
            $table->index(['visitor_id', 'last_seen_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('visitor_presences');
    }
};
