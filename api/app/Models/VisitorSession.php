<?php

namespace App\Models;

use Database\Factories\VisitorSessionFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

#[Fillable(['visitor_id', 'token_hash', 'expires_at', 'revoked_at'])]
#[Hidden(['token_hash'])]
class VisitorSession extends Model
{
    /** @use HasFactory<VisitorSessionFactory> */
    use HasFactory;

    /**
     * The plain-text token, only available on the instance that issued it.
     */
    public ?string $plainTextToken = null;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'expires_at' => 'datetime',
            'revoked_at' => 'datetime',
        ];
    }

    /**
     * @return BelongsTo<Visitor, $this>
     */
    public function visitor(): BelongsTo
    {
        return $this->belongsTo(Visitor::class);
    }

    /**
     * Issue a new session for the visitor; the plain token is never stored.
     */
    public static function issueFor(Visitor $visitor): self
    {
        $plainTextToken = Str::random(64);

        $session = $visitor->sessions()->create([
            'token_hash' => static::hashToken($plainTextToken),
            'expires_at' => now()->addMinutes((int) config('brandconnect.visitor_session_minutes')),
        ]);

        $session->plainTextToken = $plainTextToken;

        return $session;
    }

    public static function hashToken(string $plainTextToken): string
    {
        return hash('sha256', $plainTextToken);
    }

    public static function findActiveByToken(string $plainTextToken): ?self
    {
        return static::query()
            ->active()
            ->where('token_hash', static::hashToken($plainTextToken))
            ->first();
    }

    /**
     * @param  Builder<self>  $query
     */
    public function scopeActive(Builder $query): void
    {
        $query->whereNull('revoked_at')->where('expires_at', '>', now());
    }

    public function revoke(): void
    {
        $this->forceFill(['revoked_at' => now()])->save();
    }
}
