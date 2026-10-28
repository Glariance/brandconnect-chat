<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Frontend URL
    |--------------------------------------------------------------------------
    |
    | The dashboard / widget SPA origin. Used in install snippets and docs.
    |
    */

    'frontend_url' => env('FRONTEND_URL', 'http://localhost:3000'),

    /*
    |--------------------------------------------------------------------------
    | Visitor Session Lifetime
    |--------------------------------------------------------------------------
    |
    | Minutes before an anonymous widget visitor's bearer token expires.
    |
    */

    'visitor_session_minutes' => (int) env('VISITOR_SESSION_MINUTES', 60 * 24 * 30),

    /*
    |--------------------------------------------------------------------------
    | Message Limits
    |--------------------------------------------------------------------------
    */

    'message_max_length' => 5000,

    /*
    |--------------------------------------------------------------------------
    | Visitor presence
    |--------------------------------------------------------------------------
    |
    | Heartbeats run from the widget while the host page is visible (~25s).
    | Offline is determined by server last_seen_at expiry — not unload/pagehide.
    | Active = online and last_activity_at within active_within_seconds.
    | Idle = online but without recent activity.
    | Hidden/background tabs should send activity=false (or pause heartbeats);
    | pausing heartbeats for ~90s marks the tab offline. Multi-tab: a visitor
    | stays online while any tab for that visitor is still heartbeating.
    |
    */

    'presence' => [
        'heartbeat_interval_seconds' => (int) env('PRESENCE_HEARTBEAT_SECONDS', 25),
        'active_within_seconds' => (int) env('PRESENCE_ACTIVE_WITHIN_SECONDS', 60),
        'offline_after_seconds' => (int) env('PRESENCE_OFFLINE_AFTER_SECONDS', 90),
    ],

];

