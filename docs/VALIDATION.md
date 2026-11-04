# Verification record — 2026-11-04

Baseline: clean main at `2eb9470bf4eb183b2127f3ffc2092216e8837d91`.
Development remote started at `44915574a37d2da75f0d61bd58d3d84951e9858d`.
PR #1 was verified open and unmerged. Work uses `fix/webhook-retries`.
Implementation commit: `43a8ddf`; test/CI commit: `8725875`.
Forms conflict/mapping and audit follow-up: `ec91f93`.

| Test | Result | Actual command and evidence |
|---|---|---|
| Typecheck | PASS | `npm.cmd run typecheck`, strict TypeScript |
| Lint | PASS | `npm.cmd run lint`, no source warnings |
| All Vitest tests | PASS | `npm.cmd run test:coverage`: 275 tests, 36 files, zero skipped |
| Unit tests | PASS | `npm.cmd run test:unit`: 58 tests, 11 files |
| Integration tests | PASS | `npm.cmd run test:integration`: 144 tests, 10 files; signed ingress, encrypted SQL queue, tenancy/onboarding, unfinished-uninstall crash recovery, real services and synthetic provider/Auth HTTP |
| Contract tests | PASS | `npm.cmd run test:contract`: 14 tests, 3 files |
| Security tests | PASS | `npm.cmd run test:security`: 94 tests, 14 files |
| E2E browser tests | PASS | `npm.cmd run test:e2e`: 12 Chromium tests with synthetic Auth/API/provider responses |
| Production build | PASS | `npm.cmd run build`: Next.js 15.5.28, operator and customer routes generated |
| Production HTTP smoke | PASS | `npm.cmd run test:smoke`: 9 checks including customer access and framing protection; temporary localhost server stopped |
| Production dependencies | PASS | `npm.cmd audit --omit=dev --audit-level=high`: 0 vulnerabilities |
| Migration execution | PASS locally and staging | All 20 migrations applied to PGlite and the newly authorized isolated Supabase staging project; live ledger ends at `20261104000000` |
| History pattern scan | PASS within scope | 245 reachable revisions, common private-key/GitHub/AWS/live payment key patterns, zero matches; values never printed |

The history scan is limited evidence, not proof that no possible secret exists.
The earlier full audit reported 14 moderate development-tool findings; production
dependencies are clean. Do not blindly force a tooling downgrade. Local runtime is
Node 26.13.0; hosted CI targets Node 22. Generated reports are uploaded by CI.

| Coverage scope | Statements | Branches | Lines |
|---|---:|---:|---:|
| All `src/lib` | 92.63% | 89.83% | 97.55% |
| Synchronization directory | 95.52% | 91.85% | 99.22% |
| Security directory | 98.95% | 98.15% | 100% |
| Runtime engine | 100% | 93.54% | 100% |
| Form synchronization | 100% | 98.02% | 100% |
| Wix verifier | 100% | 100% | 100% |
| HubSpot verifier | 100% | 100% | 100% |
| Retry policy | 100% | 100% | 100% |

Signature/retry 100% gates and the synchronization aggregate 90% gate are enforced.
Synchronization and security exceed the requested 90% statement/branch targets.
Whole-library branch coverage is 89.83%; provider/queue boundary gaps remain visible.
Compatibility-model tests under `src/sync` are not runtime-engine coverage.

Verification levels:

1. Unit-tested: mapping, timestamps, signatures, retry, idempotency, encryption and authentication.
2. Integration-tested with synthetic provider HTTP: actual SQL migrations/functions,
   signed routes, encrypted storage, real processing services, token lifecycle and pair isolation.
3. Real development infrastructure: Supabase staging migration/security/queue smoke checks passed (see below). Wix/HubSpot OAuth and contact writes remain **not verified**.
4. Production: **not deployed or verified**; no production database or customer data changes.

PGlite does not prove deployed Supabase/PostgREST or multi-process behavior. Browser
mocks do not prove provider consent or writes. The deployment and security documents
track the remaining release gates. Remote CI results must be verified independently.

Hosted Node 22 CI passed for merge commit `c70a837`:
https://github.com/kinglove58/wix-hubspot-sync/actions/runs/41692202068
This run includes installation, typecheck, coverage, lint, build, smoke, Chromium,
production audit and report upload. Later commits require their own check results.

Customer-access hosted CI also passed for `58a5de7`:
https://github.com/kinglove58/wix-hubspot-sync/actions/runs/41773192540
The pending-removal follow-up adds five tests and the twentieth migration; its latest
hosted checks must pass independently before merge.

## Isolated Supabase staging verification — 2026-11-04

The user created a new dedicated staging project. A read-only query first confirmed
zero public tables and no migration ledger. All 20 exact repository migrations were
then executed in order within one transaction. The bootstrap used the official CLI
ledger shape (`version`, `name`, `statements`); each ledger record was inserted after
its DDL. The ledger additionally has RLS and no browser-role grants. The generated
bundle and exact source roundtrip were tested in PGlite before remote execution.

Live SQL returned **20 migrations, 13 public tables, 13 RLS-enabled tables, zero
tables readable by anon/authenticated**. The last migration is `20261104000000`.
`scripts/staging-database-smoke.sql` also passed against real Supabase PostgreSQL:
privileged RPC isolation, cross-tenant pair rejection, first queue claim, duplicate
claim rejection, stale lease recovery and exhausted-retry terminal state. Synthetic
rows were rolled back. Existing unrelated Supabase projects were untouched.

After the user approved encrypted local storage of the existing staging keys,
`node scripts/staging-rest-smoke.mjs` passed **27 read-only live HTTP checks**:
public-key validation through Auth settings plus server access and public-role
permission denial (`42501`) for all 13 tables. Table reads use `limit=0`; no contact
rows were downloaded. A separate live worker RPC probe returned null for a nonexistent
event under the server key and denied the public role. The actual application
`getSupabaseAdmin()` adapter also passed table/RPC probes (HTTP 200, zero rows,
no event claimed). Credentials are DPAPI-encrypted outside Git with owner-only ACLs.
Multi-session contention, provider OAuth/writes and scheduled workers remain unverified.

HubSpot CLI 8.16.0 validated and uploaded a new private OAuth staging project on
platform 2026.09 using the user-approved scoped development key. Cloud build #1
passed for its app and webhook components. Two callbacks target the reserved staging
domain; all 14 contact subscriptions remain inactive. Auto-deploy was explicitly
skipped. No app installation, provider consent or contact write is verified. The CLI
key is stored outside Git with Windows DPAPI encryption and owner-only ACLs.

The user selected Vercel staging and approved its isolated server configuration.
The separate `wix-hubspot-sync-staging` project exists, tracks `fix/webhook-retries`,
and reserves `wix-hubspot-sync-staging.vercel.app`. Its primary environment is labelled
Production by Vercel, but it is exclusively this new staging project. Twelve variables
are persisted: eleven non-revealable Secret values and one Config publishable key.
Values were checked against the encrypted local configuration before submission.
Five independent random application secrets are retained with DPAPI and owner-only
ACLs; customer access is disabled. Node.js 22, `npm ci`, Fluid compute, Frankfurt
functions and a 300-second default function duration are configured.

Staging deployment `FWJnowuX26NJC28MQwLpxLumpCrD` for `7972108` reached Ready and
serves HTTPS at `https://wix-hubspot-sync-staging.vercel.app`. Health returned 200;
readiness returned 401 without auth and 200 with operator auth, reporting the real
database reachable and zero configured pairs. Worker dispatch returned 401 without
auth and 200 with the cron secret, with zero queued/attempted events. This proves
deployment/DB connectivity and endpoint protection, not provider synchronization.
Its build log exposed that the open-ended Node engine selected 26 despite the
project's Node 22 setting. The engine is now bounded to `>=22.12.0 <23`; a local
production build and explicit typecheck passed on actual Node 22.23.4. The next
Vercel deployment must verify the selected runtime. Hosted CI passed for `7972108`:
https://github.com/kinglove58/wix-hubspot-sync/actions/runs/41786141260

HubSpot staging build #1 was subsequently deployed successfully; the private app
exists with all subscriptions inactive. A dedicated FREE-tier QA account was created;
the CLI's subsequent local config save failed, so remote account verification is
required and creation must not be repeated. User-approved provider credentials are
encrypted locally and configured only in staging. The real Wix RSA-2048 public key
was captured from its contact-created code sample and validated with `createPublicKey`.
Six provider settings were checked before submission and verified in Vercel's settings
list, bringing staging to eighteen variables (seventeen Secret, one public Config).
No app has been installed
into a portal/site. Scheduled execution and real provider writes remain unverified.
No live production app, database or provider configuration was changed.

## Runtime-pinned deployment and provider delivery

Deployment `2grTH9b4sU7Ws52neqCQJMUu6ZVG` for `b7738db` reached Ready. Its actual
deployment settings show **Node 22.x, Fluid compute enabled, region fra1**.
Hosted CI passed: https://github.com/kinglove58/wix-hubspot-sync/actions/runs/41788467940
`scripts/deployed-staging-smoke.mjs` records the twelve deployed security/backend
checks described above. The HubSpot batch is operator-signed and empty; it is not
evidence of HubSpot-origin delivery or contact synchronization.

Wix's own Contact Created Trigger Test reported successful delivery. Supabase
contained one matching verified event, initially pending with zero attempts and a
1,790-character encrypted payload. A real worker dispatch claimed/decrypted it and
attempted Wix instance authentication; Wix returned 404 for the sample instance.
The event became `failed`, `WIX_HTTP_404`, attempt 1, `terminal=true`, no next retry.
This verifies durable signed ingress and permanent-error handling, **not successful
contact synchronization**. The failed sample was retained for audit, not deleted or
manually marked successful. No provider installation or contact write occurred.

Four Wix draft subscriptions are saved and visible, all targeting the staging
endpoint: Contact Created, Contact Updated, App Installed and App Removed. Their
catalog registration IDs include `APP_PROVISIONED_WEBHOOK` and `APP_REMOVED_WEBHOOK`;
the documented signed lifecycle payload types remain `AppInstalled` and `AppRemoved`.
Wix warns activation can take up to ten minutes. The dedicated HubSpot QA account
was also visually verified; developer test accounts do not require private-app
allowlisting. OAuth reached the final unverified-app consent screen for that QA
portal. Its acknowledgement and Connect app were not submitted. Wix Test on dev site
was prepared but not selected. Provider installation approval remains outstanding.

Hosted CI passed for `515693a`:
https://github.com/kinglove58/wix-hubspot-sync/actions/runs/41774803118
Later documentation/check-script changes require their own hosted result.
