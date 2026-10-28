<?php

use App\Http\Controllers\Api\V1\AuthController;
use App\Http\Controllers\Api\V1\BrandController;
use App\Http\Controllers\Api\V1\ConversationController;
use App\Http\Controllers\Api\V1\ConversationMessageController;
use App\Http\Controllers\Api\V1\ConversationReadController;
use App\Http\Controllers\Api\V1\LiveVisitorController;
use App\Http\Controllers\Api\V1\Widget\BrandConfigController;
use App\Http\Controllers\Api\V1\Widget\BroadcastAuthController;
use App\Http\Controllers\Api\V1\Widget\ConversationController as WidgetConversationController;
use App\Http\Controllers\Api\V1\Widget\VisitorPresenceController;
use App\Http\Controllers\Api\V1\Widget\VisitorSessionController;
use Illuminate\Support\Facades\Route;
use Laravel\Sanctum\Http\Middleware\EnsureFrontendRequestsAreStateful;

/*
|--------------------------------------------------------------------------
| Dashboard (Sanctum SPA cookie auth)
|--------------------------------------------------------------------------
| Only this group is stateful; widget routes never read the session cookie.
*/
Route::prefix('v1')->middleware(EnsureFrontendRequestsAreStateful::class)->group(function () {
    Route::post('auth/login', [AuthController::class, 'login'])
        ->middleware('throttle:login')
        ->name('api.v1.auth.login');

    Route::middleware('auth:sanctum')->group(function () {
        Route::get('auth/me', [AuthController::class, 'me'])->name('api.v1.auth.me');
        Route::post('auth/logout', [AuthController::class, 'logout'])->name('api.v1.auth.logout');

        Route::get('brands', [BrandController::class, 'index'])->name('api.v1.brands.index');
        Route::post('brands', [BrandController::class, 'store'])->name('api.v1.brands.store');

        Route::get('live-visitors', [LiveVisitorController::class, 'index'])->name('api.v1.live-visitors.index');

        Route::get('conversations', [ConversationController::class, 'index'])->name('api.v1.conversations.index');
        Route::patch('conversations/{conversation}', [ConversationController::class, 'update'])->name('api.v1.conversations.update');

        Route::get('conversations/{conversation}/messages', [ConversationMessageController::class, 'index'])
            ->name('api.v1.conversations.messages.index');
        Route::post('conversations/{conversation}/messages', [ConversationMessageController::class, 'store'])
            ->middleware('throttle:messages')
            ->name('api.v1.conversations.messages.store');
        Route::post('conversations/{conversation}/read', ConversationReadController::class)
            ->name('api.v1.conversations.read');
    });
});

/*
|--------------------------------------------------------------------------
| Widget (public + visitor bearer token)
|--------------------------------------------------------------------------
*/
Route::prefix('v1/widget')->name('api.v1.widget.')->group(function () {
    Route::get('brands/{publicId}/config', BrandConfigController::class)->name('brands.config');
    Route::post('brands/{publicId}/sessions', [VisitorSessionController::class, 'store'])
        ->middleware('throttle:visitor-sessions')
        ->name('sessions.store');

    Route::middleware('auth:visitor')->group(function () {
        Route::post('sessions/logout', [VisitorSessionController::class, 'destroy'])->name('sessions.destroy');

        Route::post('presence', [VisitorPresenceController::class, 'store'])
            ->middleware('throttle:visitor-presence')
            ->name('presence.store');

        Route::post('conversations', [WidgetConversationController::class, 'store'])->name('conversations.store');

        Route::get('conversations/{conversation}/messages', [ConversationMessageController::class, 'index'])
            ->name('conversations.messages.index');
        Route::post('conversations/{conversation}/messages', [ConversationMessageController::class, 'store'])
            ->middleware('throttle:messages')
            ->name('conversations.messages.store');
        Route::post('conversations/{conversation}/read', ConversationReadController::class)
            ->name('conversations.read');

        Route::post('broadcasting/auth', BroadcastAuthController::class)->name('broadcasting.auth');
    });
});
