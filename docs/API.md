# HTTP API

All responses omit credentials. Administrative routes require a signed operator
session cookie or `Authorization: Bearer <ADMIN_API_KEY>`. Cookie-authenticated
mutations require the configured origin. Worker routes require the separate
`Authorization: Bearer <CRON_SECRET>` and never accept dashboard credentials.

| Method and path | Purpose / request |
|---|---|
| GET `/api/health` | Public process liveness |
| GET `/api/health/ready` | Admin DB/pair/queue readiness metadata |
| POST `/api/admin/session` | `{password}`; rate-limited signed HttpOnly session |
| GET / DELETE `/api/admin/session` | Session status / sign out |
| GET `/api/admin/overview` | Connections, pairs, mappings and recent metadata |
| GET `/api/oauth/hubspot/start` | Start administrator-authorized OAuth consent |
| GET `/api/oauth/hubspot/callback` | Code/state callback with single-use state |
| POST `/api/connections/wix` | `{instanceId}`; connect installed site |
| POST `/api/connections/pair` | `{wixConnectionId,hubspotConnectionId}` UUIDs |
| POST `/api/connections/{provider}/disconnect` | `{externalAccountId}`; disable selected connection and preserve history |
| GET `/api/fields` | Discover provider mapping fields |
| PUT `/api/mappings` | `{instanceId,pairId?,mappings}`; atomic replacement |
| POST `/api/sync/run` | `{provider,instanceId,pairId?,contactId}` |
| POST `/api/webhooks/wix` | Raw signed RS256 JWT; verify and persist |
| POST `/api/webhooks/hubspot` | Signed v3 JSON event array; verify and persist |
| POST `/api/worker/dispatch` | Drain up to five due/stale events |
| POST `/api/worker/process` | `{eventIds:[uuid]}`; one to twenty requested IDs |

`pairId` is required when the site has multiple configured destinations. No arbitrary
first active connection is selected. Webhooks fan out only over explicit active pairs.
Mappings use `wixField`, `hubspotProperty`, `direction`, `transform`, `enabled` and
optional `allowEmpty`. Unsafe/unsupported destinations fail validation. Saved empty
mapping arrays disable synchronization for that pair.

Worker responses expose counts only. `attempted` can be below `requested` when the
shared time budget stops admission. Unattempted events stay queued. A 207 response
indicates failures requiring inspection; HTTP success does not prove provider health.
No public endpoint exists for blindly resetting uncertain creation intents.
