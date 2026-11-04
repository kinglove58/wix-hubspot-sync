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
| Migration execution | PASS locally | All 20 migrations applied to isolated PGlite databases; no remote database changes |
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
3. Real development provider accounts: **not verified**; no live credentials used.
4. Production: **not deployed or verified**; no remote migrations or customer data changes.

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
