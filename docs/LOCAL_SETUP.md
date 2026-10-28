# Local setup (Windows / Laragon)

Milestone 1 uses the existing Laravel app in `api/` and the TanStack frontend at the repo root. Redis is **not** required — queue and cache use the **database** driver.

## Ports

| Service | Port | Command |
|---------|------|---------|
| Laravel API | **8000** | `cd api && php artisan serve --host=127.0.0.1 --port=8000` |
| Frontend (Vite / Lovable) | **8080** | `npm run dev` (repo root) |
| Laravel Reverb | **8081** | `cd api && php artisan reverb:start` |
| Queue worker | — | `cd api && php artisan queue:work --tries=1 --sleep=1` |

Use the **same host style** everywhere (`localhost` *or* `127.0.0.1`). Mixing them breaks Sanctum cookies.

## Realtime behavior (current)

- **Conversation messages (agent + visitor):** Laravel Echo subscribes to `private-conversations.{id}` and listens for `.message.created` when `VITE_REVERB_APP_KEY` is set and Reverb is reachable. Echo is created **browser-only** (dynamic import) so TanStack SSR is unaffected.
- **Auth:**
  - Dashboard Echo auth uses Sanctum session cookies + `X-XSRF-TOKEN` against `/broadcasting/auth` (`credentials: include`).
  - Widget Echo auth uses the visitor Bearer token against `/api/v1/widget/broadcasting/auth` with **cookies omitted**.
- **Reconnect / catch-up:** after **private-channel subscription** succeeds (not merely socket `connected`), the client HTTP-fetches with `after_id` from an HTTP-only watermark and merges by server id. Echo arrivals do not advance that watermark.
- **Inbox list:**
  - Existing conversation **previews** update immediately from authorized `.message.created` events on the active subscription.
  - The list still **HTTP-polls ~5s** because discovering **entirely new** conversations needs a dedicated authorized inbox/notification channel (not implemented yet).
- **Fallback:** if Reverb/Echo is unavailable, UI shows `Realtime unavailable · polling` and message catch-up uses bounded HTTP. Sending does not depend on Echo.
- **Queue:** `MessageCreated` implements `ShouldBroadcast` and is queued — without `queue:work`, jobs sit in `jobs` and **no WebSocket frames are published**. Prefer `--sleep=1` locally to reduce idle delay after enqueue.

### If the UI shows “Realtime unavailable · polling”

Diagnose stages in order (do not only shorten poll intervals):

1. **Env:** root `VITE_REVERB_APP_KEY` must equal `api` `REVERB_APP_KEY`. Host/port/scheme must match the running Reverb process (`REVERB_SERVER_PORT=8081`, frontend Vite on **8080**). `BROADCAST_CONNECTION=reverb`. Never expose `REVERB_APP_SECRET` via `VITE_*`.
2. **Process:** something must listen on **8081** (`php artisan reverb:start`). Queue worker must be running. After env changes: `php artisan config:clear`, then restart frontend, Reverb, and the worker.
3. **WebSocket handshake:** Upgrade to Reverb `/app/{key}` returns **HTTP 101**.
4. **Auth:** agent `POST /broadcasting/auth` (cookies + CSRF); visitor `POST /api/v1/widget/broadcasting/auth` (Bearer, cookies omitted).
5. **Subscribe:** private `conversations.{id}` succeeds.
6. **Queue:** `MessageCreated` leaves `jobs` (check `failed_jobs` before deleting anything).
7. **Delivery:** receiving browser gets a `.message.created` **WebSocket frame** (not only an HTTP poll).

Local check helper (no secrets printed): `node scripts/verify-reverb-delivery.mjs`

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
CORS_ALLOWED_ORIGINS=http://localhost:8080,http://127.0.0.1:8080,http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173
SANCTUM_STATEFUL_DOMAINS=localhost:8080,127.0.0.1:8080,localhost:3000,127.0.0.1:3000,localhost:5173,127.0.0.1:5173,localhost:8000,127.0.0.1:8000

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

## Run processes (four terminals)

```bat
cd api
php artisan serve --host=127.0.0.1 --port=8000

cd api
php artisan reverb:start

cd api
php artisan queue:work --tries=1 --sleep=1

cd (repo root)
copy .env.example .env
REM set VITE_API_URL=http://localhost:8000 and VITE_REAL_CHAT=true
REM set VITE_REVERB_* to match api/.env (port 8081) — never VITE_REVERB_APP_SECRET
npm install
npm run dev
```

Frontend listens on **8080**; open `http://localhost:8080/login`.

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
| HTTP Sanctum CSRF (cold, via `artisan serve`) | ~0.7–1.0s |
| WS handshake / socket connected | ~10–20ms once Reverb is up |
| Visitor broadcasting auth | ~0.4–2.0s depending on `artisan serve` load |
| `MessageCreated` queue job | ~230–300ms |
| HTTP 201 → `.message.created` WS frame | ~0.5–0.6s in that run |

`php artisan serve` is single-threaded; overlapping browser requests stretch wall-clock time. History HTTP loads do **not** wait for Echo subscription — transcript fetch starts as soon as a conversation is selected.

## Visitor storage note

The widget wraps `sessionStorage` in a safe adapter. If storage is blocked, credentials stay **in memory only** — persistence across reload cannot be guaranteed. Expired/revoked visitor tokens start a **new** anonymous session (no recovery of another visitor’s history).

## Manual verification

1. Open `http://localhost:8080/login`, sign in with the owner you provisioned locally.
2. Open Brands; copy the brand public id from the install snippet.
3. Open `/widget-demo?brand=<public_id>` (or an incognito window).
4. Send a visitor message; confirm it appears in `/inbox` (Echo when Reverb+queue are up; otherwise next HTTP sync).
5. Reply as the agent; refresh both sides — messages should persist (API is source of truth).
6. A second visitor session must not see the first conversation.

Still explicitly pending until performed: two-browser exchange, second-origin embed with third-party storage blocked, and production `frame-ancestors` verification.

## Tests

```bat
cd api
php artisan test --compact

cd (repo root)
npm test
npm run build
node --check public/widget.js
```
