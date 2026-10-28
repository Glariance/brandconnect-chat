# Chat realtime contracts

## Channels

| Channel | Guards | Who may subscribe |
| --- | --- | --- |
| `private-conversations.{conversationId}` | `visitor`, `web` | Agent with `ConversationPolicy::view`, or the conversation’s visitor |
| `private-brands.{brandId}.inbox` | `web` only | Dashboard user with `BrandPolicy::view` / `canAccessBrand` |

Visitors and guests must not receive brand inbox auth. Unassigned agents in the same organization are denied. Cross-organization users are denied.

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
