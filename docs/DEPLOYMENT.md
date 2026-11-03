# Deployment and operations runbook

## Release decision

This checkout has local engineering fixes and automated coverage. It is **not a
production sign-off**. No remote database, deployment, provider subscription or real
contact has been changed. Use a dedicated Wix test site and HubSpot developer test
portal for acceptance. The dashboard is a shared operator console; do not expose it
as a customer self-service SaaS dashboard without user/tenant membership authorization.

## Reproducible validation

Use Node.js 22.12+ and the committed lockfile:

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run test:smoke
npm audit --omit=dev --audit-level=high
```

Tests include all source tests and `tests/`, provider request contracts, synchronization
identity/conflict cases, OAuth callback boundaries, verified webhook routes, and actual
PostgreSQL migration/claim/privilege tests using **PGlite**. PGlite is development-only;
it does not replace production PostgreSQL or prove Supabase project configuration,
PostgREST permissions, multi-process behavior, performance, or live provider contracts.

Vitest was upgraded for critical security advisories. PostCSS is overridden to a patched
compatible 8.x release. Next.js remains on its existing 15.x architecture. Remaining
moderate audit findings are in development lint tooling; review upstream updates rather
than blindly applying npm's suggested downgrade or a breaking glob-engine override.

## Supabase migration procedure

1. Verify project ID/URL in the intended environment. Take a backup and prove restore
   procedures on development infrastructure before any production rollout.
2. Inspect `supabase_migrations.schema_migrations` in that project and compare version
   values with every committed migration filename. The first six baseline migration
   versions are `20261029222930`, `20261030142327`, `20261030142329`,
   `20261030163311`, `20261031081029`, and `20261031081125`.
3. Apply pending migrations in filename order to a development project through your
   approved Supabase migration process. Do not manually rerun historical migration
   bodies: new tables/functions are intended to run once under migration tracking.
4. New migrations add explicit pairs, expiring single-use OAuth states, worker fencing,
   transactional mapping replacement, distributed leases, scoped audit records, durable
   operator login throttling, transactional Wix uninstall handling, and encrypted
   durable contact-creation intents.
5. Verify RLS is enabled and `anon`/`authenticated` have no table access or execution
   rights on privileged functions. Keep the service-role key exclusively server-side.
6. Pause old workers before rollout. Apply additive schema changes, deploy compatible
   application code, configure pairs, then resume the scheduler. Rollback application
   code only after checking queue compatibility; retain additive tables and historical
   records. Never drop customer tables as an emergency rollback.

Read-only ledger query (run in the intended Supabase project):

```sql
select version from supabase_migrations.schema_migrations order by version;
select schemaname, tablename, rowsecurity
from pg_tables where schemaname = 'public' order by tablename;
select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated');
```

No database credentials are present in this checkout; remote application of any
migration and ledger verification remain outstanding.

## Configure and connect

Set server environment values from `.env.example` in the deployment secret manager.
Use distinct random values for dashboard password, session key, CRON secret, encryption
key and optional operator API key. Serve HTTPS, configure the exact public
`APP_BASE_URL` and HubSpot redirect URI, and preserve the public request URL through
your proxy so HubSpot v3 signature verification uses the same URI that HubSpot signs.
Do not trust arbitrary forwarded host headers to build a signed URI.

Keep token encryption keys backed up separately from the encrypted database. Losing
the key requires reconnecting accounts; replacing it without re-encryption makes
stored tokens and queued payloads unreadable. Key version rotation is not implemented.

Connect HubSpot using the operator dashboard and install/connect each Wix site.
The worker can bootstrap previously unseen Wix installations, but never reconnects
an explicit disconnect or uninstall tombstone. After reinstalling, use the operator's
explicit Wix connection control to reconnect.

In **Account routing**, select the intended site and portal, then pair them. Pairs
have immutable endpoints through the public API. A site or portal can participate in
multiple explicit pairs. Webhooks fan out sequentially over those pairs; mappings and
links remain scoped to both connection IDs. Select both accounts in the dashboard.
Manual API callers must provide `pairId` when a site has multiple destinations.

Server-to-server pairing is also available:

```http
POST /api/connections/pair
Authorization: Bearer <ADMIN_API_KEY>
Content-Type: application/json

{"wixConnectionId":"<uuid>","hubspotConnectionId":"<uuid>"}
```

Select a Wix site before saving mappings or running manual synchronization. Mapping
replacement now requires `instanceId` plus `mappings` and runs transactionally. Old
`info.emails.0.email` paths are adapted to `info.emails.items.0.email`; new configuration
should use the canonical `items` paths. Reverse mappings emit contact `info` directly.
Extended field paths such as `info.extendedFields.items.custom.website` address Wix's
literal `custom.website` dictionary key. The extended field must already exist in Wix.
Country/subdivision values require Wix-compatible geographic codes; arbitrary HubSpot
country/state labels are not silently converted. Disabled mapping sets suppress writes;
an explicitly saved empty mapping configuration suppresses writes. New pairs start
with the built-in defaults until an operator saves configuration.

HubSpot reads discover available contact properties. Missing configured properties or
read-only writes fail safely; correct the mapping/permissions instead of removing
validation. Form ingestion creates missing attribution properties only and limits
custom fields to 25 per submission. Wix form field IDs must correspond to the intended
business fields; acceptance must verify the site's actual form schema.

Form contact fields obey the pair's default/custom mapping masks and transformations.
An explicitly disabled forward mapping configuration blocks form writes too. The
immutable submission `createdDate` determines conflict order; delivery and processing
time are never substituted. An existing newer/equal HubSpot contact, or an undated
submission without a reliable ordering advantage, is skipped and audited. New contacts
can omit unavailable submission time. Updates use a fresh target snapshot and the
same final timestamp preflight as contact synchronization. Success is audited only
after required contact-link persistence. The residual HubSpot final-PATCH race below
also applies to Forms.

## Provider subscriptions

Wix: `AppInstalled`, `AppRemoved`, `wix.contacts.v4.contact_created`,
`wix.contacts.v4.contact_updated`, optionally `wix.forms.v4.submission_created`.
Permissions: Read Contacts, Manage Contacts, Manage Your App, and optional Read
Submissions. Removal creates a persistent disabled installation even when no earlier
install event was received. Duplicate delivery does not undo a later explicit reconnect.

HubSpot: classic `contact.creation`/`contact.propertyChange`, or generic
`object.creation`/`object.propertyChange` with `objectTypeId: "0-1"`. Configure a
property-change subscription for **every mapped field**. Project-based webhook
subscriptions belong in the HubSpot project's configuration, not this Next.js app's
route directory. Both documented `subscriptionType` and classic `eventType` payload
names are accepted; contradictory values are rejected. Generic company events must
never be interpreted as contacts. Configure OAuth contact read/write and schema
read/write scopes according to the enabled functionality.

Official references:

- [Wix instance OAuth](https://dev.wix.com/docs/build-apps/develop-your-app/auth/authenticate-using-oauth)
- [Wix contact contract and events](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/contacts/contact-v4/introduction)
- [Wix uninstall](https://dev.wix.com/docs/api-reference/app-management/app-instance/get-app-instance)
- [Wix form submission](https://dev.wix.com/docs/api-reference/crm/forms/form-submissions/submission-created)
- [HubSpot project webhook configuration](https://developers.hubspot.com/docs/apps/developer-platform/add-features/configure-webhooks)
- [HubSpot generic event payloads](https://developers.hubspot.com/docs/apps/legacy-apps/public-apps/create-generic-webhook-subscriptions)
- [HubSpot event identity, ordering and retries](https://developers.hubspot.com/docs/api-reference/legacy/webhooks/guide)
- [HubSpot v3 signature rules](https://developers.hubspot.com/blog/oauth-token-management-hubspot-integrations)

## Scheduler and monitoring

Deploy `next build`/`next start` on a Node.js host supporting a 300-second worker
request. Configure a scheduler to **POST** `/api/worker/dispatch` every minute with
`Authorization: Bearer <CRON_SECRET>`. A platform that supports only GET cron requests
needs a trusted scheduler adapter; no unauthenticated GET worker is provided.

Each dispatch selects at most five events, claims each atomically and processes them
sequentially to avoid competing workers for the same integration. Contact/forms writes
also acquire an installation lease across application processes; OAuth refreshes have
their own per-connection lease. Provision scheduler throughput for the expected volume
and measure backlog before launch. Worker request duration is a hosting requirement,
not a guarantee that every batch fits within the platform limit.

Retries: five maximum processing attempts, delays of 1m, 10m, 100m, 2h; a provider's
Retry-After can extend the delay (up to 24h). A 10-minute expired event lease can be
reclaimed; completion is fenced by a separate monotonically increasing lease version.
Lock contention returns the event to pending after 15 seconds without spending a
retry attempt or reusing a fencing token. Attempts exhausted during a
worker crash are finalized when the dispatcher next sees the stale lease. Permanent
validation/provider errors become terminal immediately. Each worker request shares a
240-second provider-work deadline and stops admitting events after 225 seconds.

The optional `.github/workflows/dispatch.yml` provides a five-minute HTTPS dispatcher.
It is disabled until repository variable `ENABLE_SYNC_DISPATCH=true`, variable
`SYNC_BASE_URL=https://your-host`, and secret `CRON_SECRET` are configured. GitHub
scheduled workflows run from the default branch and may be delayed; the feature-branch
file is not an active production schedule. Enable only after an approved deployment
and migration acceptance. Run its manual dispatch first and inspect the outcome.
For higher throughput or strict timing use a host scheduler calling the same endpoint.

Use public `GET /api/health` for process liveness. Use operator-authenticated
`GET /api/health/ready` for DB reachability, pair count, retryable/exhausted queue count
and oldest retryable timestamp. This endpoint does **not** validate live OAuth tokens,
subscriptions, scheduler delivery or all migrations. Alert on growing backlog,
exhausted attempts, stale processing, authentication failures and webhook persistence
errors. Ship structured metadata logs to the host's logging system; never log request
bodies, provider response bodies, OAuth codes, tokens, passwords or contact fields.

The shared operator account has a database-backed budget of 10 attempts per 15-minute
window. Add trusted-ingress per-source throttling to reduce lockout denial of service.
Back up data and keys, test restores, and define retention/deletion policies for
encrypted payloads and audit records before accepting real personal data. Periodically
delete expired OAuth state metadata; do not delete active queue payloads for cleanup.

## Required live acceptance and known limits

Use two independent sites and portals; retain sanitized outcomes and internal event
IDs. Verify creation/update in both directions, email changes on linked contacts,
secondary email/phone preservation, custom fields, portal-specific properties, replay,
out-of-order delivery, signed malformed bodies, token expiry/revocation, uninstall and
explicit disconnect. Verify a record ID shared between portals remains isolated.
Inject destination timeouts, 429 + Retry-After, SQL failure after provider success,
worker termination, delayed provider search indexing and multiple simultaneous workers.

Release blockers still requiring acceptance/design work:

- Durable creation intents reserve the original encrypted email, when available, and a unique source
  identity before a create, then remember the remote ID before linking. After an
  uncertain timeout/server error/local persistence failure, retries reconcile using
  that ID or original email; they do not issue another create. Definitively rejected
  400/401/403/404/422/429 writes can retry. If reconciliation cannot find the contact,
  the queue records `CONTACT_RECONCILIATION_REQUIRED` and eventually exhausts its retry
  budget. An operator must inspect the provider and intent before any deliberate reset.
  This favors duplicate prevention over automatically repeating an uncertain write;
  it does not claim distributed exactly-once delivery or automatic recovery when a
  destination email changes before its ID is persisted. Fault-inject this protocol
  against both providers before launch. Never reset an uncertain intent blindly.
  Named contacts without email can be created using their stable source identity;
  uncertain no-email creates without a remembered destination ID require operator
  reconciliation because there is no safe email lookup. Provider-required contact
  fields still apply; the integration does not invent names or placeholder emails.
- Database leases expire after ten minutes. Provider mutations check current lease
  ownership and the shared deadline before writing. Wix revisions reject stale writes.
  HubSpot updates re-read the target timestamp immediately before PATCH and reject a
  changed snapshot; a user edit racing the final PATCH is still possible because the
  contact endpoint has no established conditional-write contract. This residual window
  requires a product decision and live acceptance; do not claim atomic cross-provider
  last-write-wins. Already in-flight HTTP writes cannot be revoked by local fencing.
- Uninstall disables queued work immediately, but cannot undo a provider request already
  in flight. Disconnect uses the installation lease and disables local credentials
  before remote revocation; failed revocation is reported and needs provider-side review.
  Full HubSpot app uninstall and customer data erasure are separate operations.
- Control scheduler overlap and test sustained load; lock contention is rescheduled
  without consuming the retry budget, but high-volume throughput still needs measurement.
- Contact deletion/merge, historic bulk import, automatic remapping of deleted linked
  contacts, geographic code conversion, encryption-key rotation and customer membership
  authorization are not implemented as completed features.
- Live Supabase migrations, provider permissions/payloads, deployed scheduler, secrets,
  alerts and production load remain unverified in this environment.

Keep the queue paused and customer traffic disabled until the relevant gates pass.
