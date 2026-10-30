<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Widget preview origins
    |--------------------------------------------------------------------------
    |
    | Exact origins allowed to embed /widget in addition to each brand's
    | allowed_origins (local widget-demo / first-party preview). Comma-separated
    | scheme://host[:port] values. www and non-www must be listed separately.
    |
    */
    'preview_origins' => array_values(array_filter(array_map(
        'trim',
        explode(',', (string) env(
            'WIDGET_PREVIEW_ORIGINS',
            env('FRONTEND_URL', 'http://localhost:8080').',http://127.0.0.1:8080',
        )),
    ))),

    /*
    |--------------------------------------------------------------------------
    | Allow HTTP localhost in brand allowlists
    |--------------------------------------------------------------------------
    |
    | When false, brand allowed_origins may not include http://localhost /
    | 127.0.0.1 / ::1. Preview origins from WIDGET_PREVIEW_ORIGINS remain valid
    | because they are configured explicitly by operators.
    |
    */
    'allow_localhost_origins' => (bool) env('WIDGET_ALLOW_LOCALHOST_ORIGINS', false),

];
