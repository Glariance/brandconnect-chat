<?php

namespace App\Support;

use Illuminate\Validation\ValidationException;

final class SavedReplyShortcut
{
    public const PATTERN = '/^\/[a-z0-9][a-z0-9_-]{0,31}$/';

    /**
     * Normalize user input to a canonical shortcut (/hello).
     *
     * @throws ValidationException
     */
    public static function normalize(string $raw): string
    {
        $value = strtolower(trim($raw));
        if ($value !== '' && ! str_starts_with($value, '/')) {
            $value = '/'.$value;
        }

        if ($value === '' || preg_match(self::PATTERN, $value) !== 1) {
            throw ValidationException::withMessages([
                'shortcut' => 'Shortcuts must look like /hello (letters, numbers, _ or -, max 32 chars after /).',
            ]);
        }

        return $value;
    }

    public static function scopeKey(?int $brandId): string
    {
        return $brandId === null ? 'org' : 'brand:'.$brandId;
    }
}
