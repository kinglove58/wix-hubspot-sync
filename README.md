# Wix ↔ HubSpot Contact Sync

A full-stack integration project for synchronizing contacts between Wix and HubSpot. This repository is being built for a technical assignment and prioritizes reliability, security, observability, and clear setup instructions.

## Planned capabilities

- Bidirectional contact create/update synchronization.
- Configurable Wix-to-HubSpot property mapping, sync direction, and optional transforms.
- Deterministic conflict resolution (latest source update wins, with explicit tie-breaking and loop protection).
- Idempotent webhook ingestion and event processing.
- Wix form submission capture with attribution metadata (UTMs, page URL, referrer, and submission time).
- HubSpot OAuth connection flow and secure server-side credential handling.
- Admin UI for connections, field mappings, sync status, and errors.

> Status: initial project foundation. Features will be marked complete only after implementation and tests are in place.

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
- **Wix:** configure the app according to the Wix app type and its current authentication model. Do not assume Wix uses the same OAuth token lifecycle as HubSpot.
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

Routes are a design plan until implemented and tested.

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
