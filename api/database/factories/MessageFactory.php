<?php

namespace Database\Factories;

use App\Enums\SenderType;
use App\Models\Conversation;
use App\Models\Message;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<Message>
 */
class MessageFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'conversation_id' => Conversation::factory(),
            'client_message_id' => (string) Str::uuid(),
            'sender_type' => SenderType::Visitor,
            'sender_user_id' => null,
            'sender_visitor_id' => fn (array $attributes) => Conversation::find($attributes['conversation_id'])?->visitor_id,
            'body' => fake()->sentence(),
        ];
    }

    public function fromAgent(User $agent): static
    {
        return $this->state(fn (array $attributes) => [
            'sender_type' => SenderType::Agent,
            'sender_user_id' => $agent->getKey(),
            'sender_visitor_id' => null,
        ]);
    }
}
