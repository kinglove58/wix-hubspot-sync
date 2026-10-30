# Wix ↔ HubSpot Contact Sync

A Next.js and Supabase integration for synchronizing Wix Contacts v4 with HubSpot CRM contacts. The implementation is being developed in a feature branch and has not yet been deployed or verified end-to-end.

## Implemented in the current feature branch

- HubSpot OAuth authorization-code flow with encrypted server-side token storage and refresh.
- Wix self-managed app site-token exchange using app credentials and the Wix app instance ID.
- Wix webhook JWT verification using the app's RS256 public key, including the nested webhook envelope.
- Durable, encrypted, idempotent webhook ingestion.
- Atomic worker claims, bounded retries, exponential backoff, and stale-worker recovery.
- Wix contact-created/updated event processing into HubSpot.
- HubSpot contact-created/property-change event processing into Wix when exactly one Wix installation is connected.
- Wix app install/uninstall lifecycle event handling, preserving historical contact links on uninstall.
- Configurable field mappings and audit logging.

## Not yet production-ready

- HubSpot and Wix app setup has not been completed against a live deployed environment.
- Wix webhook subscriptions have not been registered or tested against a live app.
- Contact mapping, loop prevention, conflict handling, and retries need automated and end-to-end validation.
- A multi-site Wix-to-HubSpot pairing model is not yet available; HubSpot-to-Wix events are safely ignored when multiple Wix installations are active.
- Dashboard, Wix form submission attribution, and production deployment are not complete.

## Stack

- Next.js App Router + TypeScript
- Supabase Postgres for durable state and event deduplication
- Zod for environment/input validation
- Vitest for unit tests

## Local setup

1. Install Node.js 20 or newer.
2. Install dependencies: `npm install`
3. Copy `.env.example` to `.env.local` and fill in the values you have configured.
4. Apply the SQL migration in `supabase/migrations` to your Supabase project.
5. Start the app: `npm run dev`

Do not commit `.env.local`, access tokens, client secrets, webhook secrets, or real customer data.

## Environment variables

See [`.env.example`](.env.example). OAuth and webhook secrets must be stored server-side. Never expose them through variables prefixed with `NEXT_PUBLIC_`.

## Integration design

- **HubSpot:** OAuth authorization code flow for user-authorized CRM access; validate state, exchange codes server-side, and store tokens securely.
- **Wix:** this project uses a self-managed app and exchanges app credentials plus the installed instance ID for a site-scoped token. Keep the app ID and secret server-side.
- **Webhooks:** verify provider authenticity before accepting events; persist accepted events before processing.
- **Idempotency:** use provider event IDs where available and a stable deduplication key otherwise.
- **Loop prevention:** persist source/system metadata and skip events caused by this integration where the provider supports reliable correlation.
- **Conflict handling:** compare provider update timestamps when available; record the selected winner and reason for auditability.

## Initial API plan

| Route | Purpose |
| --- | --- |
| `GET /api/health` | Health check without exposing secrets |
| `POST /api/webhooks/hubspot` | Receive verified HubSpot events |
| `POST /api/webhooks/wix` | Receive verified Wix events |
| `GET /api/oauth/hubspot/start` | Start HubSpot OAuth |
| `GET /api/oauth/hubspot/callback` | Complete HubSpot OAuth |
| `POST /api/connections/:provider/disconnect` | Revoke/disconnect a provider |
| `GET/PUT /api/mappings` | Read and validate mapping configuration |
| `POST /api/sync/run` | Trigger a controlled sync operation |

Routes are not a production contract until deployed and verified.

## Development checks

- `npm run lint`
- `npm run typecheck`
- `npm test`

## Security checklist

- Keep credentials server-side and out of logs.
- Verify webhook signatures/timestamps according to each provider's documented scheme.
- Validate request bodies and enforce payload size limits.
- Use least-privilege scopes.
- Protect dashboard and mutation endpoints with authentication and authorization.
- Apply database row-level security where client access is enabled; use service credentials only on the server.
- Avoid storing unnecessary personal data and provide a disconnect/data-retention path.

## License

No license has been selected yet. Until one is added, standard copyright applies.
