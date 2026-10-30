<?php

namespace Tests\Unit;

use App\Support\OriginAllowlist;
use InvalidArgumentException;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class OriginAllowlistTest extends TestCase
{
    public function test_normalizes_exact_origins(): void
    {
        $this->assertSame('https://shop.example.com', OriginAllowlist::normalize('https://shop.example.com/'));
        $this->assertSame('https://shop.example.com', OriginAllowlist::normalize('HTTPS://SHOP.EXAMPLE.COM'));
        $this->assertSame('https://shop.example.com:8443', OriginAllowlist::normalize('https://shop.example.com:8443'));
        $this->assertSame('http://localhost:8080', OriginAllowlist::normalize('http://localhost:8080', allowLocalhostHttp: true));
    }

    public function test_www_and_apex_remain_distinct(): void
    {
        $list = OriginAllowlist::normalizeList([
            'https://www.example.com',
            'https://example.com',
        ]);

        $this->assertSame(['https://www.example.com', 'https://example.com'], $list);
    }

    #[DataProvider('rejectsProvider')]
    public function test_rejects_malformed_and_unsafe_origins(string $origin): void
    {
        $this->expectException(InvalidArgumentException::class);
        OriginAllowlist::normalize($origin, allowLocalhostHttp: true);
    }

    /**
     * @return array<string, array{0: string}>
     */
    public static function rejectsProvider(): array
    {
        return [
            'wildcard host' => ['https://*.example.com'],
            'wildcard any' => ['*'],
            'credentials' => ['https://user:pass@example.com'],
            'path' => ['https://example.com/shop'],
            'query' => ['https://example.com?x=1'],
            'fragment' => ['https://example.com#x'],
            'ftp' => ['ftp://example.com'],
            'lookalike path sneak' => ['https://example.com.evil.tld/https://example.com'],
        ];
    }

    public function test_localhost_http_requires_flag(): void
    {
        $this->expectException(InvalidArgumentException::class);
        OriginAllowlist::normalize('http://localhost:8080', allowLocalhostHttp: false);
    }

    public function test_frame_ancestors_merges_preview_and_fails_closed_on_empty(): void
    {
        $this->assertSame(
            ['https://shop.example.com', 'http://localhost:8080'],
            OriginAllowlist::frameAncestors(
                ['https://shop.example.com'],
                ['http://localhost:8080'],
                allowLocalhostHttp: false,
            ),
        );
        $this->assertSame([], OriginAllowlist::frameAncestors(null, [], false));
    }

    public function test_allows_checks_exact_normalized_origin(): void
    {
        $allowed = ['https://shop.example.com'];
        $this->assertTrue(OriginAllowlist::allows($allowed, 'https://shop.example.com'));
        $this->assertFalse(OriginAllowlist::allows($allowed, 'https://www.shop.example.com'));
        $this->assertFalse(OriginAllowlist::allows($allowed, 'https://shop.example.com:8443'));
        $this->assertFalse(OriginAllowlist::allows($allowed, 'https://shop.example.com.evil.test'));
    }
}
