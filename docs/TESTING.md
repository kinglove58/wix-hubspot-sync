# Testing

Use Node 22.x (22.12+) and `npm ci`. Windows PowerShell may require `npm.cmd`.

| Command | Scope |
|---|---|
| `npm run typecheck` | Strict TypeScript |
| `npm run lint` | ESLint source/config checks |
| `npm test` | All Vitest unit, integration, contract and security tests |
| `npm run test:unit` | Mapping, conflict, echo and retry functions |
| `npm run test:integration` | SQL migrations, synchronization, durable intents, leases and signed ingress workflows |
| `npm run test:contract` | Exact provider HTTP methods, paths, envelopes and event identities |
| `npm run test:security` | Authentication, OAuth callbacks/lifecycle, signatures, encryption, request limits and worker protection |
| `npm run test:coverage` | Entire Vitest suite with HTML, LCOV, JSON summary and JUnit reports |
| `npm run build` | Production Next.js compilation and route generation |
| `npm run test:smoke` | Temporary production server and unauthenticated HTTP security checks |
| `npm run test:e2e` | Chromium operator and customer flows against synthetic Auth/API/provider responses; requires prior build |

Install Chromium once with `npx playwright install chromium` (CI uses `--with-deps`).
Tests use synthetic records only. They do not need or read real provider credentials.
PGlite applies every migration to a fresh PostgreSQL engine. The test adapter translates
the Supabase query interface to parameterized SQL; it does not emulate deployed
PostgREST, network partitions, PostgreSQL connection pools or Supabase project settings.

`full-workflow.test.ts` invokes signed webhook routes, encrypted queue persistence,
SQL claims, real processing/mapping/identity services and mocked provider HTTP together.
`oauth-lifecycle.test.ts` checks DB state replay/expiry, exchange, encrypted token
storage, reconnect, rotation, bounded 401 refresh and revoked credentials.
Browser tests exercise actual rendered production UI but intercept application API
calls; they do not prove live OAuth consent or provider writes.

`customer-tenancy.test.ts` applies the real tenancy/onboarding migrations and exercises
verified identities, role revocation, resource scoping, immutable/competing ownership,
RLS, signed Wix proof, consent binding, cancellation, expiry and replay. Additional
security tests cover outages, ambiguous pairs, public-key configuration, provider
introspection errors and redirect restrictions. Six customer browser cases cover
signup verification, session restore/logout, organization switching, viewer controls,
mapping/manual sync, Wix context removal and mocked HubSpot consent.

Reports are written to `coverage/`, `reports/`, `playwright-report/` and `test-results/`.
CI uploads them even on failure. Coverage goals remain 90% statements/branches for
critical business logic and complete signature/retry branches. A passing test suite
does not imply those targets were met; consult the actual dated validation record.

The synchronization directory has an aggregate 90% gate for statements, branches,
functions and lines, in addition to engine/Forms-specific and signature/retry gates.
The security directory also enforces an aggregate 90% gate for all four measures.
Forms tests cover delayed/undated events, disabled and partial mappings, contact-link
failures, schema limits, array fields, attribution and audit ordering. A SQL workflow
also verifies persisted custom mappings in both directions without losing defaults.

Removal-barrier regressions cover pending, processing and failed uninstall states,
site isolation, legacy account metadata, bootstrap/refresh/reconnect rejection and
restricted SQL execution. A SQL-backed workflow simulates a receiver crash after
verified persistence, blocks both sync directions, then completes removal and safely
reconnects without letting the completed event disable the new credentials.

Before production, run the multi-account matrix and concurrent worker crash/timeout
cases in isolated Supabase, Wix and HubSpot development accounts. Verify configured
callbacks, scopes, signed payloads, optional portal properties, token revocation,
uninstall, Retry-After, delayed search indexing and user edits during writes. Record
sanitized event IDs and outcomes; never use customer contact data for acceptance.

For a designated isolated staging database, `scripts/staging-database-smoke.sql`
checks constraints, grants and queue transitions with synthetic records rolled back.
For live read-only PostgREST checks, securely inject `SUPABASE_URL`,
`SUPABASE_SECRET_KEY`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and
`ALLOW_STAGING_SMOKE=true`, then run `node scripts/staging-rest-smoke.mjs`.
It validates the public key against Auth, checks server reads with `limit=0` and
requires PostgreSQL permission denial for the public role on all 13 tables. It uses
three bounded workers, 20-second timeouts and rejects redirects; it never prints
keys or response payloads. These checks require real staging access and do not run
in ordinary CI. Never inject production credentials for acceptance tests.

`node scripts/deployed-staging-smoke.mjs` checks the approved fixed staging host.
Inject `APP_BASE_URL`, `ADMIN_API_KEY`, `CRON_SECRET`, `HUBSPOT_CLIENT_SECRET` and
`ALLOW_STAGING_SMOKE=true` securely. It requires an empty retryable queue before
probing authenticated worker dispatch, validates endpoint protection and signed
empty-batch behavior, and prints status codes only. This is a manual network check,
not real provider contact acceptance, and is excluded from ordinary CI.
