<?php

namespace App\Http\Controllers\Api\V1\Widget;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Broadcast;

/**
 * Private channel authorization for widget visitors (bearer token, no cookies).
 */
class BroadcastAuthController extends Controller
{
    public function __invoke(Request $request): mixed
    {
        return Broadcast::auth($request);
    }
}
