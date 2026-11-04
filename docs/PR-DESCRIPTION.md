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

## Validation

- Strict typecheck and ESLint pass.
- 270 Vitest tests across 36 files pass, including SQL-backed signed webhook workflows,
  tenancy/onboarding and OAuth lifecycle tests with synthetic provider/Auth HTTP.
- Both signature verifiers and retry policy have 100% statement/branch coverage gates.
- Overall measured coverage: 92.40% statements / 89.31% branches. Synchronization is
  95.50% / 91.80%, with an enforced aggregate 90% gate; security is 98.95% / 98.15%.
- 12 Chromium acceptance tests pass with mocked Auth/application/provider APIs.
- Production build and 9 production HTTP smoke checks pass.
- All 19 migrations apply to isolated PGlite databases; production dependency audit: 0 vulnerabilities.

The existing development history is merged without force-pushing. Earlier regression
tests are retained and adapted to the current contract; duplicate historical migration
filenames use the canonical versions already present on main.

## Release status: NOT READY for production

No real provider acceptance, remote Supabase migration, deployment or production
scheduler execution is claimed. Customer mode requires staging Auth/ownership/consent
acceptance before activation. HubSpot's final GET/PATCH cannot atomically fence an external user edit.
Wix reinstall/site-transfer and delayed first uninstall ordering also require acceptance.
Live multi-process/load fault injection and provider/queue boundary coverage remain open.

See `docs/ENGINEERING-REPORT.md`, `docs/VALIDATION.md`, `docs/SECURITY.md` and
`docs/DEPLOYMENT.md` for evidence, remaining owners and exact configuration actions.
