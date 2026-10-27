# Local setup (Windows / Laragon)

Milestone 1 uses the existing Laravel app in `api/` and the TanStack frontend at the repo root. Redis is **not** required — queue and cache use the **database** driver.

## Ports

| Service | Port | Command |
|---------|------|---------|
| Laravel API | **8000** | `cd api && php artisan serve --host=127.0.0.1 --port=8000` |
| Frontend (Vite / Lovable) | **8080** | `npm run dev` (repo root) |
| Laravel Reverb | **8081** | `cd api && php artisan reverb:start` |
| Queue worker | — | `cd api && php artisan queue:work --tries=1` |

Use the **same host style** everywhere (`localhost` *or* `127.0.0.1`). Mixing them breaks Sanctum cookies.

## Realtime status

- **Polling: implemented.** Inbox and widget refresh messages over HTTP on a short interval. Persistent chat works without Reverb/Echo.
- **Laravel Echo (browser client): pending.** API broadcasts (`MessageCreated`) and Reverb channel authorization are in place; the React app does not yet subscribe via Echo. Run Reverb + `queue:work` so broadcasts are processed when Echo is wired later.

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

Generate Reverb credentials locally (do not commit real keys), for example with `php artisan reverb:install` / values already prompted into `.env`, or random app id/key/secret.

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
php artisan queue:work --tries=1

cd (repo root)
copy .env.example .env
REM set VITE_API_URL=http://localhost:8000 and VITE_REAL_CHAT=true
REM set VITE_REVERB_* to match api/.env (port 8081)
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

`VITE_REVERB_*` is reserved for the pending Echo client; chat already works via polling when `VITE_API_URL` is set.

## Manual verification

1. Open `http://localhost:8080/login`, sign in with the owner you provisioned locally.
2. Open Brands; copy the brand public id from the install snippet.
3. Open `/widget-demo?brand=<public_id>` (or an incognito window).
4. Send a visitor message; confirm it appears in `/inbox` (via polling).
5. Reply as the agent; refresh both sides — messages should persist (API is source of truth).
6. A second visitor session must not see the first conversation.

## Tests

```bat
cd api
php artisan test --compact

cd (repo root)
npm test
npm run build
node --check public/widget.js
```
