# Frontend audit and Laravel handoff

Reviewed baseline: `fc2fd7428f716b7c10eb4a6782fa5bc629d16254`.

## Actual implementation

- React 19, TypeScript, TanStack Start/Router, Vite 8, Tailwind 4.
- This is not a plain static Vite SPA. `vite.config.ts` uses Lovable's TanStack config; `src/server.ts` and `src/start.ts` provide server behavior. Preserve this setup until deployment is deliberately decided.
- `public/widget.js` injects a launcher and iframe pointing to `/widget`.
- `src/routes/widget.tsx` chooses a brand from hardcoded sample data.
- `src/lib/chat-store.ts` persists messages in localStorage and notifies same-origin contexts with BroadcastChannel.
- `src/routes/inbox.tsx` mixes this browser-local chat data with fictional conversations.
- `src/components/app-shell.tsx` contains the shared dashboard. Its selected brand is component state and does not filter server data.
- No Laravel project, Composer file, SQL database, login route, server authorization, or WebSocket service is present.
- Most administrative buttons, reports, visitors, team, contacts, automation, settings, and integration statuses are visual placeholders.

## Consequences and defects to address

1. Different browsers/devices cannot communicate. Cross-site embedded storage may be partitioned or blocked, so even the browser-local demo is not a reliable cross-site chat.
2. Dashboard routes are public. Never add real customer data before authentication and brand authorization exist.
3. Sample contact details and reports are not genuine leads or metrics.
4. Messages, unread counters and conversation IDs are browser-controlled; none are trustworthy identities.
5. Demo conversations share one message array, so each sample conversation can display the same transcript.
6. The widget always displays a response-time claim without availability data.
7. Widget loader now checks both message origin and iframe source before accepting a close command. This is only one hardening step, not production embedding security.
8. The widget sends close to a wildcard target origin; replace this with a validated parent-origin handshake during the real integration.
9. BroadcastChannel and storage failures require graceful handling. Do not fall back from a failed real backend into sample data.
10. Domain allowlists, private channels, attachment authorization, anti-spam controls, visitor credentials and retention remain unimplemented.

## Changes in this preparation branch

- Visible prototype notice across the dashboard.
- Integration badges no longer claim working connections.
- iframe close messages require the actual widget frame as sender.
- Laravel-specific generated files added to gitignore.
- Concrete local implementation instructions in `docs/CURSOR_MILESTONE_1.md`.

## First functional milestone

Keep the frontend at the repository root and create Laravel in `backend/`; moving the frontend now adds unnecessary churn.

Deliver agent login + authenticated brands + persistent anonymous visitor chat + agent replies + authorized Reverb events. Verify with two different browser sessions before advanced lead capture.

## Validation status

Preparation checks: npm test passed (2 files, 4 tests, including three iframe sender/origin checks). npm run build passed for client and SSR. node --check public/widget.js and git diff --check passed. No live two-device chat or browser visual verification was performed.

No PHP or Composer runtime is available in the review environment. Laravel/MySQL/Reverb execution must be verified in the developer's local PHP environment. This preparation branch does not implement a backend.
