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

## Real QA provider acceptance — 2026-11-04 evening

The user approved both isolated installations. The real operator OAuth callback
connected HubSpot QA portal `149697146`; the parent portal was not installed.
Created an unpublished blank Wix Editor development site, **Wix HubSpot Sync QA**
(site `8c069c36-31fd-4325-9cea-3a1e5851b70f`), and installed the draft app there.
Its actual signed `AppInstalled` event succeeded through the deployed worker and
created installation `04ffe45c-f4bf-4999-aadb-90120b49e18a`. The dashboard saved an
explicit pair between these two QA connections. No live customer site was selected.

Actual deployed API/provider assertions passed:

- HubSpot property discovery HTTP 200.
- Synthetic Wix contact creation, application Wix-to-HubSpot sync HTTP 200,
  followed by a real HubSpot GET asserting the mapped first and last names.
- Repeat forward sync preserved exactly one persistent link.
- HubSpot last-name and email change synchronized to the same Wix contact ID;
  the real Wix GET confirmed both changed fields.
- A Wix last-name update synchronized to the same HubSpot contact ID.
- A separately created synthetic HubSpot contact synchronized into Wix; a real
  Wix GET confirmed its last name. Repeating reverse sync retained one link.
- Actual Wix contact webhooks reached encrypted event persistence. Worker batches
  returned 200: first 5 succeeded, then 1 succeeded and 1 ignored as an echo/no
  applicable write, with zero failures in those batches.

Two events received during installation before explicit pairing initially failed
closed with `EVENT_PROCESSING_FAILED`. Their later processing succeeded after the
pair was established. The original vendor sample's terminal `WIX_HTTP_404` remains
in audit history. No event status was manually rewritten.

These are **real staging provider tests**, distinct from mocked Vitest/browser
coverage. They do not certify live revocation, multiple real accounts, outage/rate
limits, conflict races, or uninterrupted scheduled operation. HubSpot subscriptions
and continuous scheduling must be separately verified before submission as an
unattended integration. Synthetic contacts remain in QA for inspection.

Follow-up: HubSpot cloud build #2 passed and deployment #2 succeeded; all fourteen
staging subscriptions are active in the deployed configuration. Actual vendor
webhook delivery remains a separate acceptance check. The QA development site's
Wix-generated owner-profile contact also synchronized inside the QA pair; the
manual assertions above used separately created synthetic example.com records.
The user approved the additional Supabase staging Vault destination and prepared
one-minute schedule. Browser connection dropped before setup, so no Vault entry,
extension or scheduler job has yet been created by this follow-up.

HubSpot live ingress follow-up: cloud build/deployment #2 activated all 14
subscriptions. A creation immediately after activation produced no persisted event
within the first polling window; it was not marked successful. A subsequent real
API property update produced `object.propertyChange`, verified and persisted by
the endpoint, then a deployed worker returned 200 with one success. Its linked Wix
contact was retrieved and its expected last name asserted. This is actual
HubSpot-origin signed ingress, not an operator-forged fixture. A fresh post-activation
creation check is recorded separately when complete.

Dashboard follow-up commit `2b1656b` skips field discovery without a selected portal,
separates its transient error from operation notices, and corrects the paired mapping
hint. Actual Node22 typecheck and targeted lint passed. Hosted validate CI passed:
https://github.com/kinglove58/wix-hubspot-sync/actions/runs/41887158011
Vercel deployment `7dKUKgLsRrsn5of8z1zWq8QJyUqm` succeeded. A clean local Node22
production build also passed. An earlier local build failed collecting route data;
a generated-cache archive temporarily included by TypeScript caused a second local
failure. Moving that generated archive outside the source tree resolved it. No
source route or security check was removed or disabled.

Final live check: a fresh post-activation synthetic HubSpot creation produced
`object.creation`, persisted pending, then a worker batch returned 200 with four
successes and one ignored event. The resulting Wix contact's expected name was
asserted by a real GET. A final Wix echo event was ignored by another worker run.
Readiness returned 200, database reachable, one configured pair, zero retryable
events and the one intentionally retained exhausted vendor sample. Both HubSpot
creation and property-change signed ingress are now verified. The first immediate
post-deployment creation timeout remains recorded honestly above.

The local Node22 browser regression rerun completed: **12 passed, zero skipped,
1.7 minutes**, using mocked customer/provider HTTP. This is separate from the real
QA API/webhook checks. Continuous staging scheduling is approved but still not
applied because Obafemi is unavailable. Its native fallback also returned the wrong
window screenshot, so no coordinate input was attempted. No production changes.

## Automatic staging worker — 2026-11-04

After the user approved Supabase Vault and scheduling, Obafemi reconnected and the
existing GitHub-backed Supabase session was restored. Cron was enabled only in the
isolated staging project. The existing worker secret was saved through the Vault
UI under `wix_hubspot_staging_cron`; no secret appeared in SQL history or Git.

The initial pg_net experiment successfully processed a synthetic contact, but live
privilege checks found that the platform grants browser DB roles access to its
transient request queue. Broad revocations did not remove those platform grants.
A separate public Data API probe returned HTTP406/PGRST106 for net, so it was not an
exposed API schema. The final job uses the supported synchronous `http` extension,
which does not put the Authorization header into that queue. The exploratory
pg_net extension was left installed, unused by the final job; no destructive drop.
The first setup transaction also exposed a forbidden revoke on Supabase-owned
internal Vault crypto helpers. That failed transaction was corrected; the final
script leaves those helpers untouched and asserts Vault schema/table browser denial.

`scripts/staging-scheduler.sql` was applied successfully to staging. Job ID1,
`wix-hubspot-staging-dispatch`, is active on `* * * * *`. Its command validates actual
HTTP200 and zero failed/deferred worker counts, otherwise raising a sanitized error.
The Vault value is looked up at runtime. Connect timeout10s, total timeout280s.
Certificate validation was not weakened. `scripts/staging-scheduler-verify.sql`
confirmed both browser roles lack Vault usage and decrypted-secret SELECT privileges.

Two consecutive **final synchronous** automatic runs succeeded:

| Run | UTC start | UTC finish | Result |
|---|---|---|---|
| 5 | 2026-11-04 18:58:00 | 18:58:16 | succeeded / DO |
| 6 | 2026-11-04 18:59:00 | 18:59:02 | succeeded / DO |

Their guarded DO command requires the actual HTTP response checks to pass; this is
stronger than the earlier pg_net runs that proved only request enqueueing.
A fresh real HubSpot synthetic contact then traversed the vendor-signed webhook,
durable queue, automatic worker and linked Wix contact. A real Wix GET asserted
its expected name. **Manual dispatch calls: zero.** This acceptance was repeated
successfully after the synchronous transport replacement. Some sibling property
notifications were still pending while the assertion ran; eventual drain is checked
separately rather than falsely marking every sibling completed immediately.

The earlier no-email real contact acceptance also passed: first sync succeeded,
second skipped, one persistent link. Existing application migrations remain20;
Cron/http/Vault settings are version-controlled staging operational setup. No
production database/deployment, main push, merge, customer access activation or
external alert delivery was performed.

Automatic reverse-direction follow-up also passed: a fresh synthetic Wix contact
was created using the real installation token. Its actual signed webhook and the
one-minute timer produced a single persistent HubSpot link, and a real HubSpot GET
asserted the expected first/last name. **Manual dispatch calls: zero.** Automatic
staging synchronization is therefore verified in both directions.

Commit `f558abd` passed hosted validate CI:
https://github.com/kinglove58/wix-hubspot-sync/actions/runs/41893013502
Vercel deployment `CP11bZ6EEWecCMjqVxTTwoEyEQ8b` succeeded. The working application
source was unchanged during this scheduler follow-up; SQL/operational settings were
verified directly against the isolated staging database. The Cron UI additionally
showed seven consecutive synchronous guarded successes (runs5–11) by20:04 WAT.
