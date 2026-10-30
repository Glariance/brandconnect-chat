# Embed acceptance tests (Playwright)

Automated **real-browser** checks for brand-approved widget embedding on `feature/laravel-chat`.

These tests prove localhost fixture embedding behavior. They do **not** verify real customer-host embedding or production CDN/proxy header preservation.

## Prerequisites

1. Local stack via `npm run dev:all` (API :8000 proxy, frontend :8080, Reverb :8081, queue).
2. In `api/.env` (local only, not committed):

```env
WIDGET_ALLOW_LOCALHOST_ORIGINS=true
WIDGET_PREVIEW_ORIGINS=http://localhost:8080,http://127.0.0.1:8080
```

Restart `dev:all` after changing these so PHP workers reload config.

3. Playwright uses the system **Microsoft Edge** channel (`channel: msedge`) so a full Chromium download is not required.

## Command

```bat
npm run test:e2e:embed
```

This will:

1. Verify frontend/API health (reuses running `dev:all`).
2. Provision dedicated user `embed-e2e@localhost.test` + brands via `brandconnect:provision-owner` (idempotent).
3. Allowlist **only** `http://localhost:8090` on the test brand.
4. Serve fixture parents on `:8090` (approved) and `:8091` (unapproved).
5. Run Playwright specs (isolated agent/visitor contexts).
6. Write a sanitized results summary under `e2e/embed/.runtime/` (gitignored).

Credentials are stored only in `e2e/embed/.runtime/env.json` (gitignored). They are never committed or printed by the runner beyond non-secret identifiers.

## Scenario matrix

Latest local run (system Edge / `channel: msedge`, origins `http://localhost:8090` approved / `http://localhost:8091` unapproved):

| Scenario | Method | Result |
|----------|--------|--------|
| Approved parent embeds widget; presence with launcher closed | Browser | **Pass** |
| Same visitor after open; message ↔ inbox round-trip | Browser | **Pass** |
| Unapproved parent (`:8091`) cannot hydrate widget / no presence | Browser | **Pass** |
| Same hostname, unapproved port blocked | Browser | **Pass** |
| Valid `/widget` CSP + `private, no-store` | Browser request | **Pass** |
| Missing brand → `frame-ancestors 'none'` | Browser request | **Pass** |
| Dashboard HTML → `frame-ancestors 'none'` | Browser request | **Pass** |
| Brand A origin ≠ Brand B (config + HTML CSP) | Browser request | **Pass** |
| `localhost` vs `127.0.0.1` distinct in served CSP | Browser request | **Pass** |
| Wildcards / paths / credentials / www≠apex / lookalikes | PHPUnit (`OriginAllowlistTest`, `BrandOriginsTest`) | **Pass** (backend; not hosted as fixtures) |
| Reverb-outage browser disruption | — | **Not run** (shared `dev:all` stack; see PHPUnit `PresenceBroadcastResilienceTest`) |
| Production CDN/proxy CSP preservation | — | **Not run** |
| Real customer-host embedding | — | **Not run** |

Sanitized runner summary: `e2e/embed/.runtime/results.json` (gitignored).

## Cleanup

The runner stops only the fixture HTTP servers it started. It does **not** stop `dev:all`, delete unrelated brands, or run `migrate:fresh`.

Manual cleanup of the dedicated e2e owner/brand is optional and left in the DB for re-runs (idempotent provision).
