# Chat realtime contracts

## Channels

| Channel | Guards | Who may subscribe |
| --- | --- | --- |
| `private-conversations.{conversationId}` | `visitor`, `web` | Agent with `ConversationPolicy::view`, or the conversation’s visitor |
| `private-brands.{brandId}.inbox` | `web` only | Dashboard user with `BrandPolicy::view` / `canAccessBrand` |
| `private-brands.{brandId}.presence` | `web` only | Same brand access as inbox |

Visitors and guests must not receive brand inbox/presence auth. Unassigned agents in the same organization are denied. Cross-organization users are denied.

## Events

### `message.created` (`App\Events\MessageCreated`)

- Channel: conversation private channel
- After commit, queued
- Payload: message resource body for transcript sync
- Not re-dispatched on duplicate `client_message_id` retries

### `inbox.conversation.updated` (`App\Events\InboxConversationUpdated`)

- Channel: brand inbox private channel
- After commit, queued
- Reasons: `created` (new visitor conversation), `message` (new persisted message), `status` (agent status patch)
- Payload:

```json
{
  "conversation": {
    "id": "uuid",
    "brand_id": 1,
    "status": "open",
    "visitor_name": "Pat",
    "page": "/pricing",
    "last_message_preview": "…",
    "last_message_at": "2026-01-01T00:00:00Z",
    "updated_at": "2026-01-01T00:00:00Z",
    "version": "2026-01-01T00:00:00Z"
  },
  "reason": "created"
}
```

Excluded: visitor tokens, unread counts, internal notes, message bodies.

## Frontend fallback

1. HTTP list load is authoritative for membership and unread.
2. After inbox channel `subscribed` (and after reconnect), reconcile via HTTP and merge with any events that arrived during the request (newer `version` wins).
3. Stop routine 5s discovery polling only when every required brand inbox subscription is healthy **and** reconciliation completed.
4. On failure / timeout / disconnect / brand API 403: restore non-overlapping list polling; refresh brands and resubscribe after recovery.
5. Shared agent Echo is ref-counted; leaving a channel does not disconnect other subscribers.

## Access revocation

Private channel auth runs at subscribe time, not on every broadcast. Clients refresh `GET /api/v1/brands` after reconnect and brand-filter changes, leave channels that disappear, and treat list **403** as revocation.

## Visitor presence

Presence is **independent of conversations**.

| Piece | Behavior |
| --- | --- |
| Bootstrap | `public/widget.js` mounts and **navigates** the iframe immediately on page load (closed chrome uses off-screen `opacity:0`, not `display:none`); `/widget` issues/resumes a visitor bearer session and sends the **first** presence upsert immediately without opening the popup or creating a conversation |
| Conversation | Created/resumed on first visitor message (or when the popup opens with a stored conversation id) |
| Heartbeat | `POST /api/v1/widget/presence` immediately, then about every **25s** while the **host** page is visible (`bc:host-visibility` / `bc:host-state`). Failed **initial** registration uses short bounded backoff and surfaces errors to the widget; auth expiry renews the visitor session once (no retry spin). Do not use the iframe document’s Page Visibility API — a closed panel must not mark the visitor offline |
| Handshake | Iframe posts `bc:widget-ready` after its message listener is installed; loader replies with `bc:host-state` (page, open, visible). Load listeners are registered before `iframe.src` is assigned |
| Diagnostics | Append `?diag=1` on the brand page (propagated into the iframe) or open `/widget?...&diag=1` in DEV to see stage timings (including per-request ms) without tokens |
| Broadcast | `presence.updated` uses `ShouldBroadcastNow` (skips queue worker sleep); dashboard keeps HTTP list polling as fallback |
| Fields | `tab_id` (per tab), sanitized `page` (path only), `chat_opened`, `activity` |
| Active | Online and `last_activity_at` within **60s** |
| Idle | Online (heartbeat within **90s**) without recent activity |
| Offline | No tab heartbeat within **90s** (server timestamps). Not dependent on `unload`/`pagehide` |
| Multi-tab | One row per visitor; closing one tab does not offline remaining heartbeating tabs |
| Dashboard | `GET /api/v1/live-visitors` + `.presence.updated` on `brands.{id}.presence` |
| Consent | Default: tracking starts when the script loads. Opt-in: `data-require-consent="true"` then `BrandConnect.trackingConsent = true` / `BrandConnect.enableTracking()` |
| Privacy | No form contents, keystrokes (beyond activity boolean), fingerprints, or IP merging. Credentials stay in the iframe; never in URLs/DOM/logs/events |

Storage-blocked browsers still get an in-memory visitor session for the tab lifetime; a reload creates a new visitor.
