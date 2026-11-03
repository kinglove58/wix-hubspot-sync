# Engineering report — 2026-11-03

## A. Executive summary

Audited the existing application, six baseline migrations, integrations, routes, tests,
environment references and CI. Retained Next.js/TypeScript/Supabase and implemented
explicit shared-account pairing, provider contract corrections, OAuth replay protection,
durable create reconciliation, mapping safety, fenced workers and terminal retries.
Follow-up inspection also corrected stale Forms updates, disabled-mapping bypass,
fabricated submission times and premature success auditing. Removed an unused
single-row mapping writer so configuration has one atomic write path.
Production status: **NOT READY**. Controlled staging is the next verification environment.

## B. Architecture

Verified ingress persists encrypted events before acknowledgement. Protected workers
claim events atomically, resolve explicit pairs, serialize site/portal writes, normalize
and map current provider snapshots, compare versions and save stable links/audits.
Creation intents reconcile uncertain writes rather than blindly creating duplicates.
See `ARCHITECTURE.md` for layers, data flow, conflicts, fallback rules and limits.

## C. Implementation

| Important files | Change |
|---|---|
| `src/app/api/webhooks/{wix,hubspot}/route.ts` | Bounded signed ingress, validated payloads, durable persistence |
| `src/lib/webhooks/{event-store,processor,retry-policy,event-types}.ts` | Scoped idempotency, explicit fan-out, fencing, classification and terminalization |
| `src/lib/providers/wix/{client,contacts}.ts` | Instance credentials, v4 items envelopes, revisions, exact lookup, pagination |
| `src/lib/providers/hubspot/{client,oauth,schema}.ts` | Portal credentials, property discovery, token lifecycle, single-use state, timestamp preflight |
| `src/lib/providers/connections.ts` | Encrypted lifecycle and local-first disconnect |
| `src/lib/sync/{engine,form-submission,creation-intent,lease,audit-context}.ts` | Stable identities, recovery, scoped locks, shared budget, correlated audits |
| `src/lib/sync/{contact-mapping,normalize,nested-mapping,provider-mapping,mapping-repository,connection-repository}.ts` | Defaults/custom merging, explicit empty policy, pair-scoped configuration |
| `src/lib/security`, `env.ts`, `supabase/admin.ts` | Sessions, origin checks, key validation, safe logs and server-only credentials |
| `src/app/api/{connections/pair,mappings,sync/run,worker,health/ready}` | Explicit routing, protected bounded work and queue readiness |
| `src/app/page.tsx` | Shared-pair selection, empty-value control, notices and accessible labels |
| Eleven new SQL migrations | Pairing, states, fencing, transactions, leases, audit scope, login limits, uninstall, intents and terminal state |
| `tests`, `playwright.config.ts`, `vitest.config.mts` | SQL workflows, contract/security tests, coverage gates, browser acceptance |
| `package*.json`, `next.config.ts`, `eslint.config.mjs`, `scripts/smoke.mjs` | Reproducible dependencies and working production quality commands |
| `.github/workflows/{ci,dispatch}.yml` | Full validation, report upload and gated scheduling |
| `README.md`, `docs/*.md` | Audit, architecture, security, API, tests, deployment and evidence |

The Git diff provides the complete file inventory. Generated test reports remain ignored.

## D. Security

Remediated arbitrary portal selection, OAuth replay, unfenced completion, uncertain
duplicate creates, unsafe mapping clears, stale refresh writes and uninstall replay.
Signature/retry statements and branches measure 100% and are gated. See `SECURITY.md`.
Open P1 conditions: shared operator authorization cannot serve customer self-service;
HubSpot's final-read/PATCH sequence cannot prevent an external edit racing the PATCH.

## E. Testing

See `VALIDATION.md` for the required command/result table and measured coverage.
233 Vitest tests and 6 Chromium tests pass; zero Vitest tests skipped. Production build
and seven HTTP smoke checks pass. Provider HTTP is synthetic; SQL uses PGlite.
Overall coverage: 91.85% statements / 88.48% branches; runtime engine: 100% / 93.54%.
Synchronization measures 95.67% statements / 91.94% branches and security measures
98.01% / 97.18%, meeting the core targets. Whole-library branch coverage is 88.48%;
live provider and production checks remain unverified.

## F. Database

Inspected six baseline migrations, including all four named in the assignment plus
privilege lockdown/indexing. Created eleven migrations `20261101000000`–`20261101000010`.
All 17 apply to isolated local PGlite databases. None was applied to remote development,
staging or production. Target Supabase migration ledger remains unverified.
New pair FKs preserve historical rows with `NOT VALID` while checking new writes.
After reviewing original pair ownership, reconcile orphans and validate
`contact_links_pair_fk` and `field_mappings_pair_fk` in staging. Never delete history
or invent ownership to pass a constraint. See the deployment ledger/RLS queries.

## G. GitHub

Branch `fix/webhook-retries`; main unchanged. PR #1 verified open and unmerged.
Implementation `43a8ddf`, tests/CI `8725875`; documentation follows separately.
Forms safety follow-up is implemented in `ec91f93`, with 27 focused Forms tests and
two additional SQL-backed workflows. Synchronization now has an aggregate 90% gate.
The divergent development history was merged as `c70a837` without force-pushing;
its three regression test files were retained and adapted to the current contracts.
Hosted Node 22 CI passed for that merge:
https://github.com/kinglove58/wix-hubspot-sync/actions/runs/41692202068
Subsequent commits add tests/documentation; inspect their own hosted checks before merge.
No PR merge or production deployment was performed or authorized.

## H. Outstanding work

| Priority | Action | Owner / reason |
|---|---|---|
| P1 | Real Wix/HubSpot development acceptance and callback/scope/subscription checks | Account owner + QA; mocks cannot prove live setup |
| P1 | Apply staging migrations, reconcile historical pairs and verify RLS/PostgREST | Database owner; remote ledger unavailable locally |
| P1 | Resolve/accept documented HubSpot edit-race semantics | Product + engineering; no verified atomic conditional PATCH |
| P1 | Customer membership/resource authorization before self-service use | Engineering; console currently grants global operator access |
| P1 | Actual HTTPS deployment, secrets, scheduler execution and alerts | Hosting/account owner after staging approval |
| P2 | Extend provider/queue boundary coverage and concurrent crash/load fault injection | Engineering + QA; core coverage targets met, live fault testing outstanding |
| P2 | Retention, key rotation, restore exercise and ingress throttling | Security/operations before real personal data |
| P2 | Contact deletion/merge, geographic conversion and bulk import | Product scope and provider acceptance |

## I. Production readiness

**NOT READY.** Local verification supports controlled staging evaluation. Remaining
P1 conditions prevent production sign-off. No claim of distributed exactly-once effects,
fully atomic cross-provider last-write-wins or an active production scheduler is made.

## J. Exact next actions

1. **Supabase:** choose an isolated development project, inspect its migration ledger,
   apply pending migrations in order, configure reviewed pairs, reconcile history and
   validate the pair FKs. Verify RLS, grants and queue claims. Configure server-only
   `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` on the host.
2. **Wix:** install the self-managed app on test sites; configure Read/Manage Contacts
   and lifecycle permissions, public RSA key and HTTPS `/api/webhooks/wix`. Subscribe
   to `AppInstalled`, `AppRemoved`, `wix.contacts.v4.contact_created` and
   `wix.contacts.v4.contact_updated`. Test optional Forms separately. Configure
   `WIX_APP_ID`, `WIX_APP_SECRET`, `WIX_WEBHOOK_PUBLIC_KEY` in host settings.
3. **HubSpot:** configure exact HTTPS `/api/oauth/hubspot/callback`, contact/schema
   scopes for enabled features and HTTPS `/api/webhooks/hubspot`. Subscribe to contact
   creation/property changes for every mapped property. Set `HUBSPOT_CLIENT_ID`,
   `HUBSPOT_CLIENT_SECRET`, `HUBSPOT_REDIRECT_URI`, optional `HUBSPOT_SCOPES` securely.
   Connect each test portal using OAuth.
4. **Host:** deploy to approved staging on a Node host supporting 300-second requests.
   Set `APP_BASE_URL`, `DASHBOARD_PASSWORD`, `SESSION_SECRET`, `TOKEN_ENCRYPTION_KEY`,
   `CRON_SECRET`, optional `ADMIN_API_KEY` and provider/DB variables securely. Use distinct
   strong values and preserve the signed public URL through the proxy.
5. **Scheduler:** configure a trusted host scheduler or gated GitHub dispatcher. For
   GitHub set repository `SYNC_BASE_URL`, secret `CRON_SECRET`, then
   `ENABLE_SYNC_DISPATCH=true` only after staging acceptance. Scheduled execution runs
   from the default branch after an approved merge; manual dispatch can first test
   staging. Verify actual execution/backlog and alert on failures.
6. **Acceptance:** explicitly pair intended sites/portals, run the full multi-account
   matrix with synthetic test contacts, and inject retries/crashes/revoke/uninstall/
   conflicts. Retain sanitized evidence, resolve P1 decisions and obtain separate
   approval before production. Do not send credentials or contact payloads in chat.
