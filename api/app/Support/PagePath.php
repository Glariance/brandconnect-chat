<?php

namespace App\Support;

use Illuminate\Support\Str;

/**
 * Sanitizes visitor page context: path only, no query/fragment.
 */
final class PagePath
{
    public static function sanitize(?string $page): string
    {
        $raw = trim((string) $page);
        if ($raw === '') {
            return '/';
        }

        // Absolute URLs → path only.
        if (str_contains($raw, '://')) {
            $path = parse_url($raw, PHP_URL_PATH);

            return self::clamp(is_string($path) && $path !== '' ? $path : '/');
        }

        // Strip query/fragment from relative paths.
        $path = strtok($raw, '?#') ?: '/';
        if (! str_starts_with($path, '/')) {
            $path = '/'.$path;
        }

        return self::clamp($path);
    }

    private static function clamp(string $path): string
    {
        return Str::limit($path, 500, '');
    }
}
