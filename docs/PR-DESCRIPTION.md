## Problem and behavior

The original queue/synchronization paths could select unrelated accounts, repeat
uncertain creates, overwrite newer snapshots, clear fields through partial mappings,
and let stale workers complete newer claims. This change routes only through explicit
site/portal pairs, reconciles durable creation intents, preserves stable identities and
default fields, and fences bounded workers with terminal failure handling.

Includes corrected Wix v4 collection contracts, portal-scoped HubSpot property/token
handling, single-use OAuth state, local-first disconnect, correlated audit records,
many-to-many pair support, operator UI controls and a gated scheduler workflow.

Forms now enforce the same mapping masks and target conflict checks. Immutable
submission times replace processing-time fallbacks, link failures cannot produce
success audits, and provider retry guidance survives audit-store failures. Removed
the unused nontransactional single-row mapping writer.

Customer access adds an optional Supabase-authenticated `/customer` workspace,
organization membership/roles, scoped management APIs, atomic immutable provider
ownership, signed Wix owner context verified by Token Info, and tenant-bound HubSpot
consent with independent private browser nonce and fresh user/membership verification.
Customer access is disabled by default pending real staging acceptance. The root
operator console remains privileged and separate.

A durable pending-removal barrier now blocks Wix credential activation and both
sync directions until a persisted uninstall finishes. SQL and crash-recovery workflow
tests cover bootstrap, refresh, reconnect, site scope and legacy unscoped removals.
This does not guess occurrence order for first-delayed uninstall delivery after reconnect.

## Validation

- Strict typecheck and ESLint pass.
- 275 Vitest tests across 36 files pass, including SQL-backed signed webhook workflows,
  tenancy/onboarding and OAuth lifecycle tests with synthetic provider/Auth HTTP.
- Both signature verifiers and retry policy have 100% statement/branch coverage gates.
- Overall measured coverage: 92.63% statements / 89.83% branches. Synchronization is
  95.52% / 91.85%, with an enforced aggregate 90% gate; security is 98.95% / 98.15%.
- 12 Chromium acceptance tests pass with mocked Auth/application/provider APIs.
- Production build and 9 production HTTP smoke checks pass.
- All 20 migrations apply to isolated PGlite and the authorized Supabase staging project. Live SQL smoke checks pass for RLS/grants, privileged RPCs, tenant-pair rejection and queue recovery/exhaustion; synthetic rows rolled back. Production dependency audit: 0 vulnerabilities.

The existing development history is merged without force-pushing. Earlier regression
tests are retained and adapted to the current contract; duplicate historical migration
filenames use the canonical versions already present on main.

## Live isolated staging verification

Both approved QA installations are connected and explicitly paired. Real provider
assertions pass for contact creation and update in both directions, email changes
with stable IDs, and repeat-sync single links. Actual Wix AppInstalled and contact
webhooks processed successfully. HubSpot cloud build/deployment #2 activated 14
subscriptions; actual signed object.creation and object.propertyChange deliveries
persisted and produced linked Wix contacts through the deployed worker. Subsequent
Wix echo processing was ignored, with no failed worker attempts in these batches.
A Wix-generated account-owner contact also synchronized inside QA; manual assertions
used separate synthetic example.com records. The original vendor sample's terminal
404 is retained for audit. Final readiness: one pair, zero retryable events.

The isolated Supabase project has 20 migration entries, 13 RLS-enabled tables,
no browser-role table grants, and successful SQL/27 REST checks. Separate Vercel
staging runs Node22/Fluid/fra1. Source commit 2b1656b passes hosted CI and deployment;
local Node22 build, typecheck, targeted lint and 12 browser regressions also pass.
Dashboard metadata lookup now waits for a selected portal and its error no longer
obscures operation feedback. Connected mappings display the correct account-pair hint.

## Release status: NOT READY for production

The approved one-minute Supabase staging schedule is active and live-tested.
Its Vault credential is never queued: synchronous HTTP validates status200 and
zero failed/deferred counts before a cron run succeeds. Two consecutive guarded
runs and a real synthetic contact sync with zero manual dispatch calls passed.
Vault browser-role denials and public net-schema isolation were verified.
Production is excluded. Multi-account real acceptance, revocation/reinstall,
site transfer, live fault/load tests, customer-mode Auth/ownership/consent acceptance,
and alert delivery remain outstanding. Customer access stays disabled. HubSpot's
final GET/PATCH cannot atomically fence an external user edit; delayed first-uninstall
ordering after reconnect also requires acceptance. No production release or merge.

See docs/ENGINEERING-REPORT.md, docs/VALIDATION.md, docs/SECURITY.md and
docs/DEPLOYMENT.md for evidence, remaining owners and configuration actions.
