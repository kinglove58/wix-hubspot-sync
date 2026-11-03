# Testing

Use Node 22.12+ and `npm ci`. Windows PowerShell may require `npm.cmd`.

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
| `npm run test:e2e` | Chromium operator flows against synthetic API/provider responses; requires prior build |

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

Reports are written to `coverage/`, `reports/`, `playwright-report/` and `test-results/`.
CI uploads them even on failure. Coverage goals remain 90% statements/branches for
critical business logic and complete signature/retry branches. A passing test suite
does not imply those targets were met; consult the actual dated validation record.

Before production, run the multi-account matrix and concurrent worker crash/timeout
cases in isolated Supabase, Wix and HubSpot development accounts. Verify configured
callbacks, scopes, signed payloads, optional portal properties, token revocation,
uninstall, Retry-After, delayed search indexing and user edits during writes. Record
sanitized event IDs and outcomes; never use customer contact data for acceptance.
