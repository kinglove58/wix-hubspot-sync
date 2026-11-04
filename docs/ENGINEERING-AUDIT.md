# Engineering audit — baseline 2026-11-01, follow-up 2026-11-03

Follow-up: PR #1 was verified through GitHub API as open and unmerged. Work now uses
`fix/webhook-retries`, based on current main while preserving the existing changes.
The final implementation supports shared endpoints through explicit many-to-many
pairs, merged defaults/custom mappings, terminal permanent failures, bounded worker
deadlines and SQL-backed workflow/OAuth tests. See `ARCHITECTURE.md`, `SECURITY.md`,
`TESTING.md` and the dated `VALIDATION.md`; baseline findings below are historical.

## Baseline and evidence

Initial working tree clean. Checked out `main` at `2eb9470bf4eb183b2127f3ffc2092216e8837d91`.
`git ls-remote origin` confirmed that main tip and development tip
`44915574a37d2da75f0d61bd58d3d84951e9858d`, also advertised as PR #1's head.
Main contains substantial work after that development commit. PR merge/open status
could not be established: GitHub CLI is absent and the web fetch failed. Remote refs
alone do not prove whether a PR is merged.

Inspected all committed application files, migrations, test files, environment example,
TypeScript, ESLint, Vitest configuration, README and CI workflow before implementation.
No AGENTS.md was found in the checkout or its parent. There is no lockfile, Next.js
configuration, database connection configuration, local environment file or deployment
manifest in the baseline. No connected Supabase tool, psql, Docker or Supabase CLI is
available. README's assertion that migrations are applied is not independent evidence.

## Initial findings (before remediation)

| Area | Current state | Risk | Required action | Priority |
|---|---|---|---|---|
| Authentication | Shared signed admin cookie; random OAuth state cookie; callback lacks admin authorization and durable state consumption | No customer ownership model; callback replay/races; unthrottled password endpoint | Bind callback to admin and atomically consume expiring state; implement tenant membership before SaaS launch | P0 |
| Wix integration | Instance-scoped token cache and revision-based updates; bare email/phone arrays | REST contract mismatch breaks reads and writes; pagination mixes cursor and offset | Use documented items envelopes and offset paging; test requests; handle lifecycle | P1 |
| HubSpot integration | Date-versioned OAuth/CRM clients; globally picks newest connected portal | Cross-customer contact disclosure and writes; refresh/disconnect races | Explicit connection pairing and account-scoped calls; fail closed on ambiguity | P0 |
| Webhooks | Verified RS256 and HubSpot v3; encrypted durable queue | Provider event IDs alone can collide across accounts; loose payload validation; unfenced lease completion | Account-aware keys and schemas; claim attempt fencing; exact event identifiers | P0 |
| Database | Six committed migrations, RLS and service-role-only grants | No tenant/pair table; loose nullable mapping FKs; contact uniqueness restricts fan-out; audit lacks account scope | Add explicit pair constraints; migration verification and DB integration tests; retain historical records | P0 |
| Synchronization | Bidirectional create/update, links, configurable mappings | Reverse mapping nests info twice; collision check after writes; concurrent create race; stale conflict snapshots; disabled mappings fall back to defaults | Correct envelope, preflight identity, serialize per pair, compare live versions, preserve disabled configuration | P0 |
| Security | AES-GCM at rest; secrets server-only | Global admin is unsuitable for customer self-service; missing login rate limit; malformed JWT temporal claim coercion | Reject invalid claims; same-origin mutations; external durable rate limit and tenant authorization | P0 |
| Testing | Vitest includes tests directory only; mostly pure helpers | src/sync tests excluded; production engine/queue/OAuth untested; no DB/live tests | Add contract, authorization, queue and engine regressions; run full checks | P1 |
| Deployment | CI installs floating dependency ranges; no deployment/scheduler config | Unreproducible builds; queue not automatically scheduled; no readiness/alerts | Lock dependencies; npm ci; run checks, dependency audit, deployment runbook and acceptance gates | P1 |

## Architecture map

Browser `src/app/page.tsx` -> shared operator session -> admin overview, fields,
mappings, provider disconnect and manual sync routes. Layout and CSS are presentation.
This is an operator console, not an authenticated multi-tenant customer dashboard.

HubSpot start/callback routes -> `providers/hubspot/oauth.ts` -> encrypted
`provider_connections`. Wix connection route -> instance client-credentials token ->
same repository. `security/admin-auth.ts` signs admin cookies; `token-crypto.ts`
encrypts tokens/payloads; `env.ts` parses optional server configuration;
`supabase/admin.ts` creates the server-only service-role client. `security/env.ts`
and `crypto.ts` are compatibility re-exports.

Webhook routes -> signature modules -> `webhooks/event-store.ts` -> encrypted
`webhook_events`. CRON-authenticated dispatch/process -> SQL claim ->
`webhooks/processor.ts` -> `sync/engine.ts` or `form-submission.ts` -> provider clients.
Engine resolves connections and mappings, normalizes/transforms fields, reads links,
selects conflict winner, performs remote writes, persists links and audit.

`lib/sync/mapping.ts`, `nested-mapping.ts`, `provider-mapping.ts`, `normalize.ts`,
`conflict.ts` provide runtime transforms. `src/sync/*` is a second legacy mapping/
conflict model used only by its own tests. `echo-guard.ts` contains another echo
policy and unscoped repository helpers; runtime processor duplicates its logic.
These parallel policies should be consolidated, not treated as coverage of runtime.

Tables: provider_connections (encrypted credentials, provider/account unique),
field_mappings (connection pair plus fields), contact_links (stable external IDs and
last provider timestamps), webhook_events (encrypted queue, due time, attempts,
processing lease), sync_audit_logs (safe outcomes). All have RLS. Six baseline
migrations establish schema, encrypted payloads and claim, retries, stale lease
finalization, revoked client-role grants, and HubSpot mapping FK index.

## Route inventory

| Routes | Boundary and finding |
|---|---|
| GET /api/health | Public liveness only; does not prove DB/provider readiness |
| GET/POST/DELETE /api/admin/session | Shared operator session; add deployed login throttling |
| GET /api/admin/overview | Operator-only global summary; must never become customer-facing unchanged |
| GET /api/fields | Operator-only metadata; baseline chooses arbitrary portal and hides discovery failures |
| GET/PUT /api/mappings | Operator-only global read; baseline arbitrary pair, non-atomic replacement |
| GET /api/oauth/hubspot/start, callback | State cookie and code exchange; durable consumption/admin callback binding missing |
| POST /api/connections/wix | Operator-only instance token bootstrap |
| POST /api/connections/:provider/disconnect | Operator-only revocation; in-flight writes/refresh need fencing |
| POST /api/sync/run | Operator-only manual contact; baseline HubSpot reads globally scoped |
| POST /api/webhooks/wix | Verify JWT, auto-bootstrap and persist; event guesses and lifecycle incomplete |
| POST /api/webhooks/hubspot | Verify raw request then persist batch; baseline lacks event schema/account scope |
| POST /api/worker/dispatch, process | CRON-only queue; per-event atomic claim, stale completion lacks ownership fence |

## External contracts checked

Official references, accessed during audit:

- [Wix Contacts v4 contract and event examples](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/contacts/contact-v4/introduction): items envelopes, contact wrapper, contact-created event type and nested entity identity.
- [Wix Update Contact](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/contacts/contact-v4/update-contact): current revision required; member primary-email restriction.
- [Wix query/filter reference](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/contacts/contact-v4/list-contacts): supported email filter and offset paging.
- [HubSpot date-versioned OAuth migration](https://developers.hubspot.com/changelog/v1-oauth-api-deprecation): 2026-03 token/introspect/revoke endpoints. Existing date-versioning must not be replaced based on older API recollection.
- [HubSpot May 2026 requirements](https://developers.hubspot.com/changelog/app-listing-and-app-certification-requirement-updates-for-may-2026): token lifecycle and distinction between revocation and full app uninstall.

Additional provider contracts require targeted reference checks and sandbox acceptance
before launch: exact lifecycle event schemas, optional contact properties and permissions,
webhook delivery timeouts/rate limits, refresh rotation and pagination at scale.

## Production acceptance gates

Do not deploy for customer data until: all migrations are tested on disposable PostgreSQL
and reviewed against the intended Supabase project's migration ledger; explicit connection
pairing is configured; isolation, concurrency, stale-worker, retry-after and crash-window
tests pass; two separate test sites/portals pass end-to-end creation/update/email-change,
collision, duplicate/reordered webhook, revocation and disconnect tests. Add durable
customer ownership/membership before customer self-service. Configure scheduler, alerting,
backups/restore drill, retention/deletion, TLS, secret rotation and login rate limiting.
Remote creation cannot be made exactly-once by a local event unique key alone. The new
creation-intent protocol reconciles successful writes followed by local failure and
blocks another uncertain create; live fault-injection acceptance remains required.

Never apply migrations to production or change customer data as part of this local audit.

## Implemented remediation

The initial table above describes the baseline, not the final code. Local changes now:

- Require explicit immutable account pairs, validate provider types and existing
  identity history, route inbound events by portal, and scope every sync HubSpot request.
- Fix Wix REST collection envelopes, offset pagination, exact email matching, response
  validation, legacy path adaptation, reverse info wrapping, extended-field dictionary
  keys, partial-update collection preservation and additional contact fields.
- Validate HubSpot property availability/writability, contact/token responses, request
  deadlines, ambiguous email matches and Retry-After. Serialize refreshes and prevent
  disconnected/reconnected credentials from being overwritten by stale refresh results.
- Add durable expiring OAuth state consumption, callback operator authorization,
  same-origin cookie mutations, and database-backed login throttling.
- Persist verified, bounded raw webhook bodies before provider calls; normalize documented
  event types, including generic HubSpot contacts and current Wix form submissions.
- Scope event idempotency to accounts and stable event attributes. Add independent lease
  fencing versions, contention deferral without retry expenditure, installation write
  leases, atomic mapping replacement and transactionally replay-safe uninstall handling.
- Check contact identity before destination updates and compare live target versions.
  Keep stable linked IDs when email changes; retain disabled mapping configuration.
- Reserve encrypted durable creation intents before remote creates. Reconcile uncertain
  results by original email/remembered ID and block a second uncertain create; establish
  matched identity links before writes or conflict skips. Forms share stable contact
  intents where available and otherwise use their stable submission identity.
  New named contacts no longer require email; their provider IDs and creation intents
  establish identity, with fail-closed reconciliation when no safe lookup exists.
- Add account-scoped audit columns, structured metadata failure logs, authenticated DB/
  queue readiness, dependency lockfile, fixed ESLint compatibility, wider test discovery,
  a production dependency audit CI gate and a detailed deployment runbook.

PGlite tests execute every committed migration against development PostgreSQL. They test
queue claims/retries/leases, grants/RLS restrictions, OAuth consumption, mapping rollback,
pair validation, contention fencing and uninstall replay. Provider/engine/route tests
verify local contracts without live credentials. This does not verify Supabase's remote
migration ledger, PostgREST behavior or provider sandbox behavior.

Remaining release gates and failure-model limitations are tracked explicitly in
[DEPLOYMENT.md](DEPLOYMENT.md). Most importantly, local tests are not evidence of
distributed exactly-once delivery across a provider-success/local-failure crash,
nor of multi-process behavior under a long suspension past lease expiry. Customer
membership authorization was subsequently implemented with local SQL/API/browser tests
and remains disabled pending live acceptance; see `TENANCY-DESIGN.md`. Contact
deletion/merge, historic import and key rotation remain outside the implemented feature set.
The legacy pure `src/sync` model and its
tests remain separate from runtime services and must not be counted as engine coverage.
