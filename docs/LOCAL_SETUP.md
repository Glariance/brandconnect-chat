# Local setup (Windows / Laragon)

Milestone 1 uses the existing Laravel app in `api/` and the TanStack frontend at the repo root. Redis is **not** required — queue and cache use the **database** driver.

## Ports

| Service | Port | Command |
|---------|------|---------|
| Laravel API | **8000** | `cd api && php artisan serve --host=127.0.0.1 --port=8000` |
| Frontend (Vite / Lovable) | **8080** | `npm run dev` (repo root) |
| Laravel Reverb | **8081** | `cd api && php artisan reverb:start --host=127.0.0.1 --port=8081` |
| Queue worker | — | `cd api && php artisan queue:work --sleep=1 --tries=3` |

Use the **same host style** everywhere (`localhost` *or* `127.0.0.1`). Mixing them breaks Sanctum cookies.

## One-command local stack (`npm run dev:all`)

**Local development only.** Starts API, Vite frontend, Reverb, and a queue worker from the repo root after first-time setup is done.

### First-time prerequisites (not performed by the launcher)

1. Install PHP 8.3+ (Laragon), Node 20+, Composer, MySQL — see Prerequisites below.
2. Create the database and copy/configure `api/.env` and root `.env` (never commit secrets).
3. `cd api && composer install && php artisan key:generate && php artisan migrate` (+ provision owner as needed).
4. At repo root: `npm install`.
5. Align `VITE_REVERB_*` with `api` Reverb keys (see Frontend env). Do **not** put `REVERB_APP_SECRET` in `VITE_*`.

Optional PHP override (machine-local, not committed):

```powershell
$env:PHP_BINARY = "D:\laragon\bin\php\php-8.3.30\php.exe"
```

The launcher prefers `PHP_BINARY`, then `php` on PATH, then the Laragon path above.

### Start / stop

```powershell
cd D:\laragon\www\awsodesk
npm run dev:all
```

- Logs are prefixed `[FRONTEND]`, `[API-PROXY]`, `[API-8011]`…, `[REVERB]`, `[QUEUE]` (plus `[LAUNCHER]` status).
- “Starting” means the child process was spawned; “READY” means HTTP (API/frontend) or TCP (Reverb) checks passed. Queue “running” does **not** prove message delivery.
- Stop with **Ctrl+C** in that terminal — the launcher terminates its process tree (including Windows child processes) and removes `.dev-all.lock`.
- From another terminal: `npm run dev:all:stop` (writes `.dev-all.stop` for a graceful shutdown, then force-cleans lock children if needed).
- Existing `npm run dev` (frontend only) is unchanged.

### Port conflicts

If 8000 / 8011–8013 / 8080 / 8081 is already taken, `dev:all` **exits with instructions** and does **not** kill the existing process. Free the port yourself (or stop a previous stack), then retry.

### Duplicate launchers

A second `npm run dev:all` while the first is alive refuses to start (`.dev-all.lock`). If a crash left a stale lock and no process holds that PID, the next run clears it.

## Realtime behavior (current)

- **Conversation messages (agent + visitor):** Laravel Echo subscribes to `private-conversations.{id}` and listens for `.message.created` when `VITE_REVERB_APP_KEY` is set and Reverb is reachable. Echo is created **browser-only** (dynamic import) so TanStack SSR is unaffected. Dashboard agents share a **ref-counted** Echo instance (`acquireAgentEcho` / `releaseAgentEcho`) so one component’s cleanup does not disconnect another active subscription.
- **Auth:**
  - Dashboard Echo auth uses Sanctum session cookies + `X-XSRF-TOKEN` against `/broadcasting/auth` (`credentials: include`).
  - Widget Echo auth uses the visitor Bearer token against `/api/v1/widget/broadcasting/auth` with **cookies omitted**.
- **Reconnect / catch-up:** after **private-channel subscription** succeeds (not merely socket `connected`), the client HTTP-fetches with `after_id` from an HTTP-only watermark and merges by server id. Echo arrivals do not advance that watermark.
- **Inbox discovery (agents):**
  - Channel: `private-brands.{brandId}.inbox` (Echo name `brands.{brandId}.inbox`).
  - Event: `.inbox.conversation.updated` (`InboxConversationUpdated`), queued after DB commit.
  - Payload (minimal): `conversation.id`, `brand_id`, `status`, safe `visitor_name`, `page`, `last_message_preview`, `last_message_at`, `updated_at`, `version`, plus `reason` (`created` | `message` | `status`). No visitor tokens, no actor-specific `unread_count`, no message bodies.
  - Authorization: `BrandPolicy::view` / `User::canAccessBrand` on the **web** guard only. Guests, visitor bearer credentials, unassigned agents, and other-organization users are denied. Organization membership alone does **not** grant agent brand access.
  - Frontend subscribes only to brand IDs returned by `GET /api/v1/brands`, including **All brands** (one channel per authorized brand). List rows merge/reorder/remove by active status + brand filters; stale `version` values are rejected; selection/draft/pending sends are preserved; agents are **not** auto-switched to new conversations.
  - Unread counts stay authoritative on the server via debounced HTTP list reconcile (not invented from fan-out events).
  - Message bodies still use `private-conversations.{id}` / `.message.created`. Duplicate `client_message_id` retries do **not** re-dispatch inbox notifications.
- **Fallback:** HTTP remains the authoritative initial list and reconciliation source. Routine **~5s inbox list polling** runs until **all required inbox subscriptions are healthy and reconciliation has completed**; it resumes (non-overlapping) on subscribe failure, timeout, or disconnect. Message catch-up uses the existing bounded HTTP pattern. Sending does not depend on Echo.
- **Access revocation:** Laravel does **not** re-authorize every published event on an already-subscribed private channel. Strategy: refresh authorized brands after reconnect / brand-filter change and `leave` channels missing from `GET /api/v1/brands`; treat list/API **403** as revocation and drop inbox subscriptions + restore polling.
- **Queue:** `MessageCreated` and `InboxConversationUpdated` implement `ShouldBroadcast` + `ShouldDispatchAfterCommit` and are queued — without `queue:work`, jobs sit in `jobs` and **no WebSocket frames are published**. Prefer `--sleep=1` locally to reduce idle delay after enqueue.

### If the UI shows “Realtime unavailable · polling”

Diagnose stages in order (do not only shorten poll intervals):

1. **Env:** root `VITE_REVERB_APP_KEY` must equal `api` `REVERB_APP_KEY`. Host/port/scheme must match the running Reverb process (`REVERB_SERVER_PORT=8081`, frontend Vite on **8080**). `BROADCAST_CONNECTION=reverb`. Never expose `REVERB_APP_SECRET` via `VITE_*`.
2. **Process:** something must listen on **8081** (`php artisan reverb:start`). Queue worker must be running. After env changes: `php artisan config:clear`, then restart frontend, Reverb, and the worker.
3. **WebSocket handshake:** Upgrade to Reverb `/app/{key}` returns **HTTP 101**.
4. **Auth:** agent `POST /broadcasting/auth` (cookies + CSRF); visitor `POST /api/v1/widget/broadcasting/auth` (Bearer, cookies omitted).
5. **Subscribe:** private `conversations.{id}` and/or `brands.{brandId}.inbox` succeed.
6. **Queue:** broadcast jobs leave `jobs` (check `failed_jobs` before deleting anything).
7. **Delivery:** receiving browser gets a `.message.created` or `.inbox.conversation.updated` **WebSocket frame** (not only an HTTP poll).

Local check helper (no secrets printed): `node scripts/verify-reverb-delivery.mjs`

### Manual acceptance (inbox discovery)

1. Open an agent `/inbox` session and a separate visitor browser (widget demo).
2. Start a **new** visitor conversation.
3. Confirm the inbox row appears via the brand inbox WebSocket event **without** waiting for the ~5s list poll.
4. Confirm messaging on an existing conversation still works over `conversations.{id}`.

### Manual acceptance (live visitor presence)

1. Open agent **Live Visitors** and a brand page with the widget script (do **not** open chat).
2. Confirm the visitor appears (label, brand, page, active/idle, chat closed).
3. Open/minimize the popup: same visitor, `chat_opened` toggles, no duplicate identity.
4. Send the first message: conversation appears in Inbox; visitor identity unchanged.
5. Multi-tab / reload / separate browsers: see `docs/CHAT_REALTIME.md` presence section.

**Regression (closed popup):** the loader must keep the iframe navigated with closed chrome (`opacity:0` / off-screen, still `display:block`) and heartbeats must follow **host** `bc:host-visibility`, not the iframe Page Visibility API. Using CSS `display:none` previously made `document.visibilityState === "hidden"` inside the iframe and suppressed presence until the launcher opened.

## Prerequisites

- PHP 8.3+ (Laragon): `php -v`
- Composer: `composer -V`
- MySQL 8.4 (Laragon). CLI if not on PATH:
  `D:/laragon/bin/mysql/mysql-8.4.3-winx64/bin/mysql.exe`
- Node 20+ / npm

## Database

```bat
"D:\laragon\bin\mysql\mysql-8.4.3-winx64\bin\mysql.exe" -u root -e "CREATE DATABASE IF NOT EXISTS brandconnect_chat CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

Copy `api/.env.example` to `api/.env` if needed, then set (never commit secrets):

```
APP_URL=http://localhost:8000

DB_CONNECTION=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=brandconnect_chat
DB_USERNAME=root
DB_PASSWORD=

FRONTEND_URL=http://localhost:8080
# BrandConnect SPA origins only (dashboard + widget iframe host) — not customer parent sites.
CORS_ALLOWED_ORIGINS=http://localhost:8080,http://127.0.0.1:8080,http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173
SANCTUM_STATEFUL_DOMAINS=localhost:8080,127.0.0.1:8080,localhost:3000,127.0.0.1:3000,localhost:5173,127.0.0.1:5173,localhost:8000,127.0.0.1:8000
WIDGET_PREVIEW_ORIGINS=http://localhost:8080,http://127.0.0.1:8080
WIDGET_ALLOW_LOCALHOST_ORIGINS=false
REVERB_ALLOWED_ORIGINS="${CORS_ALLOWED_ORIGINS}"

QUEUE_CONNECTION=database
CACHE_STORE=database
SESSION_DRIVER=database
BROADCAST_CONNECTION=reverb

REVERB_APP_ID=
REVERB_APP_KEY=
REVERB_APP_SECRET=
REVERB_HOST=localhost
REVERB_PORT=8081
REVERB_SCHEME=http
REVERB_SERVER_HOST=0.0.0.0
REVERB_SERVER_PORT=8081
```

Generate Reverb credentials locally (do not commit real keys).

Then:

```bat
cd api
composer install
php artisan key:generate
php artisan migrate
php artisan brandconnect:provision-owner --email=you@example.com --name="Your Name" --brand="Demo Brand"
```

Omit `--password` so the command prompts securely. Do **not** commit a shared demo password. Do **not** use `migrate:fresh` on a shared database.

## Manual four-terminal fallback

Prefer `npm run dev:all` when possible. Equivalent manual commands:

```bat
cd api
php artisan serve --host=127.0.0.1 --port=8000

cd api
php artisan reverb:start --host=127.0.0.1 --port=8081

cd api
php artisan queue:work --sleep=1 --tries=3

cd (repo root)
REM ensure .env exists with VITE_* (never VITE_REVERB_APP_SECRET)
npm run dev
```

Frontend listens on **8080** (`strictPort`); open `http://localhost:8080/login` or `http://127.0.0.1:8080/login`.

## Frontend env (`/.env`)

```
VITE_API_URL=http://localhost:8000
VITE_REAL_CHAT=true
VITE_REVERB_APP_KEY=<same as REVERB_APP_KEY in api/.env>
VITE_REVERB_HOST=localhost
VITE_REVERB_PORT=8081
VITE_REVERB_SCHEME=http
```

Do **not** add `VITE_REVERB_APP_SECRET` (or any other secret) to the frontend env.

## Observed local timings (not a guarantee)

On one local diagnose pass with Reverb + `queue:work --sleep=1` already running:

| Stage | Observed |
|-------|----------|
| In-process CSRF + `/auth/me` + conversations + messages | ~184ms sum |
| HTTP Sanctum CSRF (cold, via `artisan serve` worker) | ~0.7–1.0s |
| WS handshake / socket connected | ~10–20ms once Reverb is up |
| Visitor broadcasting auth | ~0.4–2.0s when a single worker is saturated |
| `MessageCreated` queue job | ~230–300ms |
| HTTP 201 → `.message.created` WS frame | ~0.5–0.6s in that run |
| Widget config / session / presence (individual, warm worker) | ~0.7–1.5s HTTP each; in-process Laravel ~10–140ms after boot |
| Five parallel configs on one `artisan serve` | wall ~4.4s (serialized ~0.5s steps) |
| Same pattern via `dev:all` multi-worker proxy | wall ≈ single-request latency |

`php artisan serve` is single-threaded. `npm run dev:all` runs **three** workers (`8011`–`8013`) behind a Node reverse proxy on **8000** so Live Visitors polling does not block widget bootstrap. Presence broadcasts use `ShouldBroadcastNow` (no queue sleep). History HTTP loads do **not** wait for Echo subscription — transcript fetch starts as soon as a conversation is selected.

## Visitor storage note

The widget wraps `sessionStorage` in a safe adapter. If storage is blocked, credentials stay **in memory only** — persistence across reload cannot be guaranteed. Expired/revoked visitor tokens start a **new** anonymous session (no recovery of another visitor’s history).

## Manual verification

1. Open `http://localhost:8080/login`, sign in with the owner you provisioned locally.
2. Open Brands; copy the brand public id from the install snippet.
3. Open `/widget-demo?brand=<public_id>` (or an incognito window).
4. Send a visitor message; confirm it appears in `/inbox` (Echo when Reverb+queue are up; otherwise next HTTP sync).
5. Reply as the agent; refresh both sides — messages should persist (API is source of truth).
6. A second visitor session must not see the first conversation.

Still explicitly pending until performed: two-browser exchange on separate machines, third-party storage-blocked embed on a real customer domain, and production CDN/proxy confirmation that `Content-Security-Policy` / `Cache-Control` on `/widget` are not stripped.

## Widget embedding (approved origins)

| Layer | Role |
|-------|------|
| `public/widget.js` | Classic script tag on the customer site (no CORS needed for `<script src>`). Served from the BrandConnect frontend origin. |
| `/widget?brand=` HTML | Iframe document. TanStack `src/server.ts` sets **`Content-Security-Policy: frame-ancestors …`** from that brand’s `allowed_origins` + `WIDGET_PREVIEW_ORIGINS`, plus **`Cache-Control: private, no-store`**. Missing/invalid brands → `frame-ancestors 'none'`. |
| Dashboard HTML | `frame-ancestors 'none'` (not embeddable). |
| API CORS | `CORS_ALLOWED_ORIGINS` = BrandConnect SPA hosts (iframe + dashboard). Customer parent origins are **not** required for API CORS because XHR runs inside the iframe. |
| Reverb | `REVERB_ALLOWED_ORIGINS` = same SPA hosts (Echo connects from the iframe/dashboard, not the parent page). |
| `postMessage` | Loader ↔ iframe: `event.source` checks + approved parent origin after config load. Not authentication. |

Owners/admins manage brand origins on **Brands** (exact `scheme://host[:port]`; www ≠ apex; no wildcards/paths/credentials). Set `WIDGET_ALLOW_LOCALHOST_ORIGINS=true` only for local brand-origin experiments with `http://localhost`.

### Production proxy notes

Ensure the edge proxy forwards `/widget` to the TanStack app **without** replacing CSP. Prefer appending security headers only on non-widget routes, or merge carefully so brand-specific `frame-ancestors` is preserved. Do not cache `/widget` HTML across brands (`Vary` / `Cache-Control: private, no-store` already set by the app).

## Tests

```bat
cd api
php artisan test --compact

cd (repo root)
npm test
npm run build
node --check public/widget.js
```
