<?php

use App\Models\Brand;
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

/*
| Brand inbox summaries are dashboard-only. Authorization reuses BrandPolicy::view
| (canAccessBrand) — org membership alone does not grant access for agents.
| Visitors/guests cannot subscribe (web guard only).
|
| Revocation: Laravel does not re-run channel auth on every published event.
| Clients must refresh authorized brands after reconnect and drop channels that
| disappear from GET /api/v1/brands; API 403 on list/reconcile should also drop
| the brand subscription.
*/
Broadcast::channel('brands.{brand}.inbox', function (?User $user, Brand $brand) {
    return $user instanceof User && Gate::forUser($user)->allows('view', $brand);
}, ['guards' => ['web']]);

/*
| Live visitor presence is dashboard-only (same BrandPolicy as inbox).
| Visitors/guests cannot subscribe. Revocation strategy matches inbox:
| refresh authorized brands after reconnect; leave missing channels; treat API 403 as revocation.
*/
Broadcast::channel('brands.{brand}.presence', function (?User $user, Brand $brand) {
    return $user instanceof User && Gate::forUser($user)->allows('view', $brand);
}, ['guards' => ['web']]);
