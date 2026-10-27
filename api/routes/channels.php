<?php

use App\Models\Conversation;
use App\Models\User;
use App\Models\Visitor;
use Illuminate\Support\Facades\Broadcast;
use Illuminate\Support\Facades\Gate;

Broadcast::channel('App.Models.User.{id}', function ($user, $id) {
    return $user instanceof User && (int) $user->id === (int) $id;
});

/*
| Agents are authorized through brand access (dashboard session at
| /broadcasting/auth); visitors through their own conversation (bearer token
| at /api/v1/widget/broadcasting/auth). The visitor guard is checked first so
| a dashboard cookie never stands in for a visitor credential.
*/
Broadcast::channel('conversations.{conversation}', function (User|Visitor $actor, Conversation $conversation) {
    return Gate::forUser($actor)->allows('view', $conversation);
}, ['guards' => ['visitor', 'web']]);
