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

];
