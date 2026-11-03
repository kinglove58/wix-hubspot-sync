## Problem and behavior

The original queue/synchronization paths could select unrelated accounts, repeat
uncertain creates, overwrite newer snapshots, clear fields through partial mappings,
and let stale workers complete newer claims. This change routes only through explicit
site/portal pairs, reconciles durable creation intents, preserves stable identities and
default fields, and fences bounded workers with terminal failure handling.

Includes corrected Wix v4 collection contracts, portal-scoped HubSpot property/token
handling, single-use OAuth state, local-first disconnect, correlated audit records,
many-to-many pair support, operator UI controls and a gated scheduler workflow.

## Validation

- Strict typecheck and ESLint pass.
- 207 Vitest tests across 32 files pass, including SQL-backed signed webhook workflows
  and OAuth lifecycle tests with synthetic provider HTTP.
- Both signature verifiers and retry policy have 100% statement/branch coverage gates.
- Overall measured coverage: 86.83% statements / 83.30% branches; broader 90% goals remain open.
- 6 Chromium acceptance tests pass with mocked application/provider APIs.
- Production build and 7 production HTTP smoke checks pass.
- All 17 migrations apply to isolated PGlite databases; production dependency audit: 0 vulnerabilities.

The existing development history is merged without force-pushing. Earlier regression
tests are retained and adapted to the current contract; duplicate historical migration
filenames use the canonical versions already present on main.

## Release status: NOT READY for production

No real provider acceptance, remote Supabase migration, deployment or production
scheduler execution is claimed. The console is shared-operator only, not customer
self-service. HubSpot's final GET/PATCH cannot atomically fence an external user edit.
Live multi-process/load fault injection and broader coverage targets remain open.

See `docs/ENGINEERING-REPORT.md`, `docs/VALIDATION.md`, `docs/SECURITY.md` and
`docs/DEPLOYMENT.md` for evidence, remaining owners and exact configuration actions.
