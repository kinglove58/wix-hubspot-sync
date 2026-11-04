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

## Optional customer API

All customer routes are disabled unless `CUSTOMER_ACCESS_ENABLED=true`. Use a verified
Supabase Auth `Authorization: Bearer <customer access token>`, plus `X-Tenant-ID` for
organization-scoped requests. Operator cookies/keys do not authorize this namespace.
Owners/admins may mutate; viewers may read. Inputs are bounded and resource ownership
is checked server-side. Missing/foreign resources fail closed without exposing tokens.

| Method and `/api/customer` path | Purpose |
|---|---|
| GET / POST `/tenants` | List own active organizations / create `{name}` and owner membership; no tenant header needed |
| GET `/overview` | Scoped connection/pair/mapping/event/audit metadata |
| GET `/fields?hubspotConnectionId=UUID` | Owned portal mapping properties; omit ID for static Wix options |
| POST `/connections/wix` | `{instance}` signed owner context, never raw instance ID |
| POST `/connections/pair` | `{wixConnectionId,hubspotConnectionId}`; both owned and active |
| POST `/connections/{provider}/disconnect` | `{externalAccountId}`; own account only |
| PUT `/mappings` | Same mapping schema as operator API, scoped to own explicit pair |
| POST `/sync/run` | Same sync schema as operator API, scoped to own explicit pair |
| POST `/oauth/hubspot/start` | Start customer/tenant-bound consent; returns authorization URL and private HttpOnly nonce cookie |
| GET `/oauth/hubspot/callback` | Single-use state/code callback with private nonce and fresh user/membership validation |
| POST `/oauth/hubspot/cancel` | Same-origin private nonce capability cancels pending consent and clears cookie; no Auth JWT needed for expired-session logout |

Callback and cancellation authenticate through the private browser binding rather
than custom browser headers. See `TENANCY-DESIGN.md` for exact setup and constraints.
