# Visitor arrival sound & toasts

## Root cause (pre-fix)

Live Visitors showed **Realtime unavailable · polling** and produced no chime because the dashboard had **no arrival notification or audio implementation** — only a Settings placeholder mentioning sounds. Polling and Echo both updated the table, but nothing announced arrivals.

## Behavior now

- **Baseline:** first successful HTTP hydrate (and brand-filter resets) seed known visitors with **no** alerts.
- **New arrivals** after baseline ring/toast once, whether discovered via Echo `appeared` or HTTP polling reconcile.
- Heartbeats, duplicate Echo/HTTP delivery, reconnect replay of already-known IDs, and filter changes do **not** re-alert.
- After offline expiry, a later visit uses a new `first_seen_at` appearance key and alerts once again.
- Brand filter scopes the list; widget pages never play agent sounds.
- **Enable sound** is an explicit gesture that unlocks `AudioContext`. Preferred mute/volume persist in `localStorage`; unlocked state is per browser session/gesture.
- Toasts are in-app only (Sonner). OS notification permission is never requested.

Web Audio two-tone chime — no paid asset dependency.
