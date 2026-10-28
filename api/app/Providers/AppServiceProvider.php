<?php

namespace App\Providers;

use App\Models\Visitor;
use App\Models\VisitorSession;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use Illuminate\Support\Str;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        $this->configureVisitorGuard();
        $this->configureRateLimiting();
    }

    /**
     * Widget visitors authenticate only with a hashed bearer token, never with
     * the dashboard session cookie.
     */
    protected function configureVisitorGuard(): void
    {
        Auth::viaRequest('visitor-token', function (Request $request): ?Visitor {
            $token = $request->bearerToken();

            if (blank($token)) {
                return null;
            }

            $session = VisitorSession::findActiveByToken($token);

            return $session?->visitor?->withCurrentSession($session);
        });
    }

    protected function configureRateLimiting(): void
    {
        RateLimiter::for('api', function (Request $request): Limit {
            return Limit::perMinute(120)->by($this->rateLimitKey($request));
        });

        RateLimiter::for('login', function (Request $request): array {
            return [
                Limit::perMinute(5)->by(Str::lower((string) $request->input('email')).'|'.$request->ip()),
                Limit::perMinute(20)->by($request->ip()),
            ];
        });

        RateLimiter::for('visitor-sessions', function (Request $request): Limit {
            return Limit::perMinute(10)->by($request->ip());
        });

        // ~25s heartbeats + SPA page bumps; keep headroom for multi-tab.
        RateLimiter::for('visitor-presence', function (Request $request): Limit {
            return Limit::perMinute(30)->by($this->rateLimitKey($request));
        });

        RateLimiter::for('messages', function (Request $request): Limit {
            return Limit::perMinute(30)->by($this->rateLimitKey($request));
        });
    }

    /**
     * Agents and visitors share numeric IDs, so keys are prefixed by actor type.
     */
    protected function rateLimitKey(Request $request): string
    {
        $actor = $request->user();

        if ($actor === null) {
            return 'ip:'.$request->ip();
        }

        return class_basename($actor).':'.$actor->getAuthIdentifier();
    }
}
