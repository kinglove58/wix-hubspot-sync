# Wix ↔ HubSpot Contact Sync

A self-managed Next.js integration that synchronizes Wix contacts and form submissions with HubSpot contacts. The project is designed for a technical assignment and prioritizes secure credentials, verified webhooks, idempotent processing, configurable mappings, conflict handling, and an auditable event queue.

## Current implementation

- HubSpot OAuth authorization-code flow using the current 2026-03 token lifecycle API, plus 2026-03 CRM contact/property APIs, state validation, encrypted access/refresh token storage, and refresh-token revocation on disconnect.
- HubSpot access-token refresh and contact create/update/search APIs.
- Wix self-managed app instance-token generation and encrypted token caching.
- Wix webhook JWT verification with the app's RSA public key.
- HubSpot v3 webhook signature verification.
- Durable webhook event storage with encrypted payloads, deduplication, atomic claims, bounded retries, and stale-worker recovery.
- Bidirectional contact sync with configurable field mappings, nested paths/arrays, transforms, timestamp conflict resolution, and reciprocal-event suppression.
- Wix Forms submission ingestion with email/name/phone and UTM, landing-page, referrer, and submission-time attribution properties in HubSpot.
- Password-protected admin dashboard for connections, mapping configuration, manual one-contact sync, and recent event monitoring.
- Admin-only API endpoints and a separate CRON-protected queue dispatcher.

The live integrations are not considered verified until real Wix and HubSpot credentials are configured and end-to-end tests are run against test contacts.

## Architecture

- **Next.js App Router / TypeScript** — dashboard, OAuth callbacks, provider APIs, webhook receivers, and worker endpoints.
- **Supabase Postgres** — encrypted provider connections, field mappings, Wix↔HubSpot contact links, webhook queue, and audit records.
- **HubSpot CRM API** — contacts and attribution properties.
- **Wix Contacts API** — contact reads and writes for the installed app instance.
- **Vitest** — unit tests for mapping and conflict logic.

This is a self-managed Wix app integration. Wix CLI is not required for the current architecture: Wix sends signed webhook JWTs to our Next.js endpoints, and our backend calls Wix APIs using the installed app instance ID. Wix CLI event extensions are relevant if we later choose to move the webhook handling into a Wix-managed app project.

## Local setup

1. Install Node.js 22 or newer.
2. Clone this repository and run `npm install`.
3. Copy `.env.example` to `.env.local`.
4. Configure the environment variables below.
5. Apply every SQL migration in `supabase/migrations` to the Supabase project. The connected Supabase project already has the initial schema, encrypted webhook payload support, and worker retry/lease migrations applied.
6. Run `npm run dev` and open `http://localhost:3000`.

Never commit `.env.local`, OAuth credentials, encryption keys, webhook public keys with secrets (public keys are not secrets but should still be configured carefully), provider tokens, or real customer data.

## Required environment variables

| Variable | Purpose |
| --- | --- |
| `APP_BASE_URL` | Public base URL of this app |
| `DASHBOARD_PASSWORD` | Password used to sign in to the dashboard |
| `SESSION_SECRET` | Random secret of at least 32 characters for signed admin sessions |
| `TOKEN_ENCRYPTION_KEY` | 32-byte key, encoded as 64 hex characters or base64 |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only Supabase service role key |
| `HUBSPOT_CLIENT_ID` / `HUBSPOT_CLIENT_SECRET` | HubSpot developer app credentials |
| `HUBSPOT_REDIRECT_URI` | Must exactly match the HubSpot app callback URL |
| `WIX_APP_ID` / `WIX_APP_SECRET` | Wix self-managed app credentials |
| `WIX_WEBHOOK_PUBLIC_KEY` | RSA public key from the Wix app's Webhooks page |
| `WIX_INSTANCE_ID` | Optional default installed Wix app instance ID |
| `CRON_SECRET` | Secret for the scheduled queue dispatcher |
| `ADMIN_API_KEY` | Optional server-to-server admin API credential |

Generate secrets locally, for example:

```bash
openssl rand -hex 32
```

Use separate random values for `SESSION_SECRET`, `TOKEN_ENCRYPTION_KEY`, `CRON_SECRET`, and `ADMIN_API_KEY`. The encryption key must not be changed after tokens have been stored unless you first re-encrypt those tokens.

## Provider setup

### HubSpot

1. Create a project-based app in the HubSpot Developer Platform (use Projects version 2026.09) and enable OAuth.
2. Add the exact callback URL configured in `HUBSPOT_REDIRECT_URI`.
3. Request `crm.objects.contacts.read`, `crm.objects.contacts.write`, `crm.schemas.contacts.read`, and `crm.schemas.contacts.write` for property discovery and form attribution fields.
4. Add webhook subscriptions for contact creation and property changes, pointing to `/api/webhooks/hubspot`.
5. Configure the app client ID and secret in the server environment.
6. Sign in to the dashboard and choose **Connect HubSpot**. Authorize the intended test portal.

### Wix

1. Create a self-managed custom app in Wix Developer Center.
2. Configure the Wix **Read Contacts** and **Manage Contacts** permissions, then subscribe to the App Instance Installed event, contact created/updated events, and the current Wix Forms submission event supported by your app. If you use the legacy Form Submitted event, also grant **Read Form Submissions**; Wix marks that legacy Forms API event as deprecated, so prefer the current Forms V2 event when available.
3. Set the webhook callback URL to `/api/webhooks/wix`.
4. Copy the public key shown in the webhook setup sample or from App Dashboard → Home → View ID and Keys into `WIX_WEBHOOK_PUBLIC_KEY`.
5. Configure the Wix App ID and App Secret server-side.
6. Install the app on the test Wix site. The first verified Wix webhook automatically bootstraps the site connection; if you do not receive the install event, paste the app instance ID into the dashboard as a fallback.

The Wix webhook receiver verifies the signed JWT body with the app's public key before persisting any event. Do not disable this check.

## Queue processing

Webhook receivers persist verified events and return quickly. They do not perform contact synchronization in the provider request.

Schedule a POST to `/api/worker/dispatch` (for example, once per minute) with:

```http
Authorization: Bearer <CRON_SECRET>
```

The dispatcher processes due events, retries failures with bounded backoff, and recovers stale worker leases. The manual `/api/worker/process` endpoint can process a supplied batch of event UUIDs when needed.

## Important routes

| Route | Purpose |
| --- | --- |
| `GET /api/health` | Health check |
| `GET/POST/DELETE /api/admin/session` | Dashboard login/session |
| `GET /api/admin/overview` | Connections, mappings, event and activity overview |
| `GET /api/fields` | Wix and HubSpot field suggestions for mapping |
| `GET/PUT /api/mappings` | Read/save field mappings |
| `GET /api/oauth/hubspot/start` | Start HubSpot OAuth |
| `GET /api/oauth/hubspot/callback` | Complete HubSpot OAuth |
| `POST /api/connections/wix` | Connect an installed Wix app instance |
| `POST /api/connections/:provider/disconnect` | Disconnect a provider |
| `POST /api/webhooks/wix` | Verify and queue Wix events |
| `POST /api/webhooks/hubspot` | Verify and queue HubSpot events |
| `POST /api/worker/dispatch` | Process due queued events |
| `POST /api/sync/run` | Manually synchronize one contact |

Dashboard mutation routes require the signed admin session. Worker routes require the CRON secret. Supabase service-role access is restricted to server modules.

## Development checks

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Run all checks before treating the assignment as complete. Also test both directions using dedicated test contacts, replay the same webhook twice, simulate an out-of-order update, and verify that a sync-generated webhook is ignored rather than creating a loop.
