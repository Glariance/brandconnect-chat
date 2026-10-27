# Cursor task: first real Laravel chat

Use this task in Cursor Agent with this repository open. Continue on the existing feature/laravel-chat branch. Read root AGENTS.md and api/AGENTS.md before modifying code. These docs live on codex/laravel-preparation until merged; they can also be restored explicitly from that remote branch without switching branches.

## Objective

Replace the browser-local chat prototype with real persistent chat between separate browsers. Preserve the current visual design and TanStack Start routes. Do not rebuild the dashboard or change the frontend framework.

The developer has already checked PHP 8.3.30, Composer 2.9.5 and MySQL 8.4.3. The existing api/composer.json requests PHP ^8.3 and Laravel ^13.17. Inspect api/composer.lock and run php artisan --version to determine the installed framework version; preserve the existing project and lockfile. Check Node compatibility with the frontend lockfile. MySQL CLI is not on PATH; use D:/laragon/bin/mysql/mysql-8.4.3-winx64/bin/mysql.exe when needed. Keep database credentials in local environment files. Do not upgrade/recreate Laravel merely to follow an older scaffold instruction.

## Architecture

- Keep existing frontend at repository root.
- Use the existing Laravel project under api/. Do not create backend/ or another Laravel installation.
- MySQL for persistent records.
- Laravel Sanctum cookie authentication for the dashboard.
- Self-hosted Laravel Reverb and Echo for realtime events.
- No hosted Pusher account, Supabase or Firebase.
- Configure API/realtime URLs with documented environment variables.
- Demo data remains explicitly labelled; real API failures show an error and retry, never silently switch to the demo store.
- Do not remove the prototype notice until the real mode is implemented. Other placeholder pages must remain clearly labelled even after chat is functional.

## Implement in order

1. Inspect and extend the existing Laravel scaffold in api/. Run Composer commands inside api/, protect secrets and generated files, and add environment examples without overwriting local credentials. Verify root and api/.gitignore cover vendor, environment files, keys, logs, caches and development databases.
2. Add organizations, users/memberships, brands, brand-agent access, visitors, conversations, messages and visitor sessions. Store timestamps in UTC.
3. Build an idempotent interactive owner-provisioning command. Prompt securely for a password; do not commit a universal default password. Provision a development brand separately.
4. Implement login, current-user and logout. Add a login page, a protected dashboard boundary, real current-user display and logout. Keep /widget and /widget-demo public. Preserve the root Outlet.
5. Add authenticated brand listing/creation and a public widget configuration endpoint that exposes only public settings.
6. Bootstrap scoped anonymous visitor sessions. Store credential hashes server-side, expire credentials, and never treat a guessed conversation ID, email or public brand ID as authentication.
7. Add persistent conversations and messages with server-assigned sender identity. Require client message UUIDs and database uniqueness for idempotent retries.
8. Connect src/routes/inbox.tsx and src/routes/widget.tsx to the API. Retire src/lib/chat-store.ts from real mode; localStorage is never the source of truth for messages.
9. Add private Reverb channels. Authorize agents by organization/brand and visitors by their session/conversation. Do not put credentials in channel names or URLs. Store messages before broadcasting.
10. On reconnect, fetch missed messages and deduplicate by message ID. Add empty/loading/error states and a non-duplicating retry action.
11. Update the embed loader and widget with a validated parent-origin handshake. Validate postMessage origin, source and message shape on both sides. Restrict production embedding with configured domains and frame-ancestors headers. Treat origins as defense in depth, not authentication.
12. Add brand-specific install snippets and a real demo page with no misleading delivery claims.

## API contract to implement

Use /api/v1 and document exact response schemas and errors before wiring frontend calls.

Dashboard:
- POST /auth/login
- GET /auth/me
- POST /auth/logout
- GET /brands
- POST /brands
- GET /conversations?brand_id=&status=&cursor=
- GET /conversations/{id}/messages?after_id=&cursor=
- POST /conversations/{id}/messages with client_message_id and text
- PATCH /conversations/{id} for open/closed status
- POST /conversations/{id}/read with the last seen message ID

Public/visitor:
- GET /widget/brands/{publicId}/config
- POST /widget/brands/{publicId}/sessions
- POST /widget/conversations
- GET /widget/conversations/{id}/messages?after_id=&cursor=
- POST /widget/conversations/{id}/messages
- POST /widget/conversations/{id}/read
- Visitor logout/reset or token revocation endpoint

Use Laravel's CSRF endpoint and credentialed requests for dashboard cookie auth. Document local localhost/127.0.0.1 consistency, CORS and Sanctum domain configuration. Keep the dashboard/API on same-site subdomains in production.

Use a separate explicit visitor auth guard for widget requests so a dashboard cookie does not grant visitor API access. Authorize broadcast subscriptions for both flows without leaking credential values. Test iframe behavior with third-party cookies disabled; widget identity must not depend on a dashboard session cookie.

Return resource data consistently, paginate messages, validate text lengths, and use standard 401/403/422/429 errors. Do not accept organization_id or sender role from a browser as trusted authorization.

## Security and correctness

- Cross-organization, cross-brand and cross-visitor access denied on API and channel authorization.
- Reading a conversation must never mark another conversation read.
- Client cannot send agent/bot messages using visitor credentials.
- Plain-text message rendering without unsafe HTML.
- Login, visitor session and message rate limits.
- No identity recovery using IP/email matching.
- No private notes in visitor responses or broadcasts.
- Server-side allowlisted public configuration.
- Robust handling when storage is unavailable.
- No claim of agent availability or response time until backed by actual data.
- Defer uploads, AI, advanced analytics and marketing automation to later milestones.

## Required verification

Run and report:
- Laravel feature tests for login/logout, guest blocking, organization/brand isolation, visitor session isolation, sender spoofing, private channel authorization, status changes, read cursor validation and duplicate-message retry.
- MySQL migrations against a disposable development/test database; never migrate:fresh an existing database.
- Existing frontend tests and production build.
- A manual exchange between an authenticated agent and an incognito visitor, including refresh and reconnect.
- A second visitor cannot read the first visitor's conversation.
- Actual embedding on a second local origin with third-party storage blocked.

Provide exact Windows/Laragon commands for API, frontend, Reverb and queue worker, plus documented ports and environment variables. If Redis is unavailable locally, explicitly configure and document a development queue/cache alternative; do not silently imply Redis is running.

Commit code, lockfiles, environment templates and setup docs. Finish with implemented features, checks actually run, failures, and remaining items. Do not call unexecuted or mocked behavior verified.
