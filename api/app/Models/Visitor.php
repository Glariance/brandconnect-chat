<?php

namespace App\Models;

use Database\Factories\VisitorFactory;
use Illuminate\Auth\Authenticatable as AuthenticatableTrait;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * An anonymous widget visitor, authenticated through the "visitor" guard
 * with a hashed bearer token from {@see VisitorSession}.
 */
#[Fillable(['brand_id', 'name'])]
class Visitor extends Model implements Authenticatable
{
    /** @use HasFactory<VisitorFactory> */
    use AuthenticatableTrait, HasFactory;

    /**
     * The session whose bearer token authenticated the current request.
     */
    protected ?VisitorSession $currentSession = null;

    /**
     * @return BelongsTo<Brand, $this>
     */
    public function brand(): BelongsTo
    {
        return $this->belongsTo(Brand::class);
    }

    /**
     * @return HasMany<VisitorSession, $this>
     */
    public function sessions(): HasMany
    {
        return $this->hasMany(VisitorSession::class);
    }

    /**
     * @return HasMany<Conversation, $this>
     */
    public function conversations(): HasMany
    {
        return $this->hasMany(Conversation::class);
    }

    public function withCurrentSession(VisitorSession $session): static
    {
        $this->currentSession = $session;

        return $this;
    }

    public function currentSession(): ?VisitorSession
    {
        return $this->currentSession;
    }

    public function displayName(): string
    {
        return $this->name ?: 'Visitor #'.$this->getKey();
    }

    /**
     * Visitors never authenticate with a password or remember-me cookie.
     */
    public function getRememberTokenName(): string
    {
        return '';
    }
}
