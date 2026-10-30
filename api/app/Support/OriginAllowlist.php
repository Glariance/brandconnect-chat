<?php

namespace App\Support;

use InvalidArgumentException;

/**
 * Exact origin allowlisting for widget embedding (scheme + host + optional port).
 * www and non-www are distinct; wildcards and credentials are rejected.
 */
class OriginAllowlist
{
    /**
     * @param  iterable<int, mixed>  $origins
     * @return list<string>
     */
    public static function normalizeList(iterable $origins, bool $allowLocalhostHttp = false): array
    {
        $out = [];
        foreach ($origins as $origin) {
            if (! is_string($origin)) {
                throw new InvalidArgumentException('Origin must be a string.');
            }
            $normalized = self::normalize($origin, $allowLocalhostHttp);
            $out[$normalized] = $normalized;
        }

        return array_values($out);
    }

    public static function normalize(string $origin, bool $allowLocalhostHttp = false): string
    {
        $trimmed = trim($origin);
        if ($trimmed === '') {
            throw new InvalidArgumentException('Origin must not be empty.');
        }
        if (str_contains($trimmed, '*')) {
            throw new InvalidArgumentException('Wildcard origins are not allowed.');
        }
        if (preg_match('#\s#', $trimmed)) {
            throw new InvalidArgumentException('Origins must not contain whitespace.');
        }

        $parts = parse_url($trimmed);
        if ($parts === false || ! isset($parts['scheme'], $parts['host'])) {
            throw new InvalidArgumentException('Origin must be an absolute URL with scheme and host.');
        }
        if (isset($parts['user']) || isset($parts['pass'])) {
            throw new InvalidArgumentException('Origins must not include credentials.');
        }
        if (isset($parts['query']) || isset($parts['fragment'])) {
            throw new InvalidArgumentException('Origins must not include query or fragment.');
        }
        if (isset($parts['path']) && $parts['path'] !== '' && $parts['path'] !== '/') {
            throw new InvalidArgumentException('Origins must not include a path.');
        }

        $scheme = strtolower($parts['scheme']);
        if (! in_array($scheme, ['http', 'https'], true)) {
            throw new InvalidArgumentException('Origin scheme must be http or https.');
        }

        $host = strtolower($parts['host']);
        if ($host === '' || str_contains($host, '*')) {
            throw new InvalidArgumentException('Origin host is invalid.');
        }

        $port = $parts['port'] ?? null;
        if ($port !== null) {
            if ($port < 1 || $port > 65535) {
                throw new InvalidArgumentException('Origin port is invalid.');
            }
            if (($scheme === 'http' && $port === 80) || ($scheme === 'https' && $port === 443)) {
                $port = null;
            }
        }

        if ($scheme === 'http' && self::isLocalhostHost($host) && ! $allowLocalhostHttp) {
            throw new InvalidArgumentException('HTTP localhost origins require WIDGET_ALLOW_LOCALHOST_ORIGINS.');
        }

        return $port === null ? "{$scheme}://{$host}" : "{$scheme}://{$host}:{$port}";
    }

    public static function isLocalhostHost(string $host): bool
    {
        $host = strtolower($host);

        return $host === 'localhost'
            || $host === '127.0.0.1'
            || $host === '[::1]'
            || $host === '::1';
    }

    /**
     * @param  list<string>|null  $brandOrigins
     * @param  list<string>  $previewOrigins
     * @return list<string>
     */
    public static function frameAncestors(?array $brandOrigins, array $previewOrigins, bool $allowLocalhostHttp = false): array
    {
        $merged = [];

        foreach ($brandOrigins ?? [] as $origin) {
            try {
                $normalized = self::normalize((string) $origin, $allowLocalhostHttp);
                $merged[$normalized] = $normalized;
            } catch (InvalidArgumentException) {
                // Skip invalid brand entries rather than opening the frame.
            }
        }

        // Preview origins are operator-configured (explicit), so localhost HTTP is allowed.
        foreach ($previewOrigins as $origin) {
            try {
                $normalized = self::normalize((string) $origin, allowLocalhostHttp: true);
                $merged[$normalized] = $normalized;
            } catch (InvalidArgumentException) {
                // Skip invalid preview entries rather than opening the frame.
            }
        }

        return array_values($merged);
    }

    /**
     * @param  list<string>  $allowed
     */
    public static function allows(array $allowed, string $origin): bool
    {
        try {
            $normalized = self::normalize($origin, allowLocalhostHttp: true);
        } catch (InvalidArgumentException) {
            return false;
        }

        return in_array($normalized, $allowed, true);
    }
}
