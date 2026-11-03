# Verification record — 2026-11-03

Baseline: clean main at `2eb9470bf4eb183b2127f3ffc2092216e8837d91`.
Development remote started at `44915574a37d2da75f0d61bd58d3d84951e9858d`.
PR #1 was verified open and unmerged. Work uses `fix/webhook-retries`.
Implementation commit: `43a8ddf`; test/CI commit: `8725875`.

| Test | Result | Actual command and evidence |
|---|---|---|
| Typecheck | PASS | `npm.cmd run typecheck`, strict TypeScript |
| Lint | PASS | `npm.cmd run lint`, no source warnings |
| All Vitest tests | PASS | `npm.cmd run test:coverage`: 172 tests, 29 files, zero skipped |
| Unit tests | PASS | `npm.cmd run test:unit`: 52 tests, 9 files |
| Integration tests | PASS | Included in full suite; signed ingress, encrypted SQL queue, real services and synthetic provider HTTP |
| Contract tests | PASS | `npm.cmd run test:contract`: 14 tests, 3 files |
| Security tests | PASS | `npm.cmd run test:security`: 43 tests, 9 files |
| E2E browser tests | PASS | `npm.cmd run test:e2e`: 6 Chromium tests with synthetic API/provider responses |
| Production build | PASS | `npm.cmd run build`: Next.js 15.5.28, all 19 pages/routes generated |
| Production HTTP smoke | PASS | `npm.cmd run test:smoke`: 7 checks, temporary localhost server stopped |
| Production dependencies | PASS | `npm.cmd audit --omit=dev --audit-level=high`: 0 vulnerabilities |
| Migration execution | PASS locally | All 17 migrations applied to isolated PGlite databases |
| History pattern scan | PASS within scope | 245 reachable revisions, common private-key/GitHub/AWS/live payment key patterns, zero matches; values never printed |

The history scan is limited evidence, not proof that no possible secret exists.
The earlier full audit reported 14 moderate development-tool findings; production
dependencies are clean. Do not blindly force a tooling downgrade. Local runtime is
Node 26.13.0; hosted CI targets Node 22. Generated reports are uploaded by CI.

| Coverage scope | Statements | Branches | Lines |
|---|---:|---:|---:|
| All `src/lib` | 83.15% | 79.45% | 89.94% |
| Synchronization directory | 85.55% | 81.07% | 91.78% |
| Runtime engine | 90.51% | 80.64% | 93.80% |
| Wix verifier | 100% | 100% | 100% |
| HubSpot verifier | 100% | 100% | 100% |
| Retry policy | 100% | 100% | 100% |

Signature/retry 100% gates are enforced. Broader 90% critical branch targets remain
unmet. Compatibility-model tests under `src/sync` are not runtime-engine coverage.

Verification levels:

1. Unit-tested: mapping, timestamps, signatures, retry, idempotency, encryption and authentication.
2. Integration-tested with synthetic provider HTTP: actual SQL migrations/functions,
   signed routes, encrypted storage, real processing services, token lifecycle and pair isolation.
3. Real development provider accounts: **not verified**; no live credentials used.
4. Production: **not deployed or verified**; no remote migrations or customer data changes.

PGlite does not prove deployed Supabase/PostgREST or multi-process behavior. Browser
mocks do not prove provider consent or writes. The deployment and security documents
track the remaining release gates. Remote CI results must be verified independently.
