# Saved replies & slash commands

Persistent slash shortcuts for Inbox and Live Visitors composers.

## Scope and conflict rule

- **Organization-wide** replies (`brand_id` null) are available to every brand in the org.
- **Brand-specific** replies apply only to that brand.
- When the same shortcut exists in both scopes, the **brand-specific reply wins** for that brand’s composer menu. Documented and enforced in `SavedReply::resolveConflicts()`.

Shortcuts are normalized to lowercase with a leading slash (example: `/hello`). Valid pattern: `/` + 1–32 chars of `[a-z0-9_-]`, starting with alphanumeric.

Archiving soft-deletes (`archived_at`) so the shortcut can be recreated. Inactive or archived replies are excluded from composer lists.

## Permissions

| Role | Manage (CRUD) | Use in composer |
|------|---------------|-----------------|
| Owner / Admin | Yes (own organization) | Yes |
| Agent | No | Yes (accessible brands only) |

No variables / personalization tokens are supported. Bodies are plain text.

## Auto-open on agent message

When a previously unseen agent/bot message arrives (Echo, HTTP catch-up, or presence-discovered agent DM), the widget posts `bc:open` to `public/widget.js`. The loader expands the existing iframe panel (desktop card or mobile safe-area panel). It does **not** open a new tab/window or focus the composer.

History loads, pagination, and duplicate delivery seed message IDs and do not re-open the panel. Background/suspended pages may delay delivery until the host page resumes; this is not OS push notification delivery.

## API

- `GET /api/v1/saved-replies` — manage list (`q`, `brand_id`, `include_archived`)
- `GET /api/v1/saved-replies?composer=1&brand_id=` — active resolved list for a brand
- `POST /api/v1/saved-replies`
- `PATCH /api/v1/saved-replies/{id}`
- `DELETE /api/v1/saved-replies/{id}` — archive
- `POST /api/v1/live-visitors/{visitor}/messages` — agent DM (create/resume conversation)
