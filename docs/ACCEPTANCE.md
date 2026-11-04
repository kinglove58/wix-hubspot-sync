# Acceptance matrix

The table records the original automated baseline. Real isolated QA acceptance
has since verified both contact-sync directions, updates, changed email, stable
links and Wix webhook processing; see the live progress section below and
VALIDATION.md. Remaining live cases are still required for production sign-off.

| Required scenario | Automated evidence | Remaining acceptance |
|---|---|---|
| One site / one portal, both directions | Signed ingress workflow creates/updates links and audits | Actual test-account payloads and permissions |
| Two Wix sites | SQL-backed independent connection IDs | Install two real test sites |
| Two HubSpot portals | Scoped credential and routing tests | OAuth consent on two test portals |
| Shared site / several portals | Forward workflow with three explicit pairs | Verify actual fan-out and mappings |
| Shared portal / several sites | Reverse workflow excludes unrelated site | Verify independent Wix revisions |
| Multiple sites and portals | Pair-scoped link/workflow tests | Full live matrix |
| Ambiguous/manual routing | Repository fails closed; explicit pair selection | Operator/API acceptance |
| Duplicate delivery | Account-aware persisted deduplication, signed workflow | Real retry delivery |
| Changed email | Linked IDs updated without email rematching | Live provider email constraints |
| Contact without email | Both engine directions use stable provider IDs/intents | Provider-required fields and uncertain-create reconciliation |
| Provider outage / rate limit | Typed API failures, backoff/Retry-After, SQL retry workflow | Live throttling and delayed search indexing |
| Invalid signatures | Both verifiers have 100% branch gates, route rejection tests | Actual registered subscription signatures |
| Expired/revoked credentials | SQL token lifecycle, bounded 401 refresh, local disable | Real provider revocation behavior |
| Wix uninstall | Durable tombstone, history retained, further writes blocked | Signed lifecycle delivery and reinstall |
| HubSpot disconnect/reconnect | Local-first revoke and stable connection ID tests; browser flow | Live revocation and reconnect permissions |
| Conflicts / delayed events | Current snapshots, deterministic ties, revision/preflight guards | HubSpot final-PATCH edit race remains a P1 limitation |
| Customer organizations and access | SQL/route tests plus six mocked customer browser cases | Real Supabase Auth, verified Wix context and customer OAuth acceptance pending; feature off by default |
| Echo prevention | Exact provider versions, precision/time-zone and newer-edit tests | Live timestamp precision and webhook ordering |
| Worker crash / stale lease | SQL reclaim, independent completion fencing, owner/deadline checks | Multiple processes, forced termination and long suspension |
| Retry limit / permanent errors | 100% retry-policy branches, exhausted lease and terminal workflow | Deployed scheduler sweeps and alerts |
| Partial mapping | Defaults retained, empty/null opt-in, one-way masks | Portal-specific fields and Wix geographic values |
| Delayed or disabled Forms | Timestamp preflight, mapping masks, schema bounds and audit/link failure tests | Actual site submission timestamps and field IDs |
| Same IDs/emails across accounts | Pair-scoped SQL workflow; shared destinations explicit | Independent real test-account verification |
| Concurrent events | Two simultaneous processing calls create one destination identity | Multi-process/load fault injection |

Before production, retain sanitized request/event IDs and observed outcomes, verify
backups/restores and retention rules, and resolve the P1 gates in `ENGINEERING-REPORT.md`.

## Live QA progress — 2026-11-04

Real isolated Wix and HubSpot QA connections and their explicit pair are now
established. Both create directions, both update directions, changed email with
stable identity, repeat-sync single links, actual Wix lifecycle delivery and actual
Wix contact-webhook processing passed. See VALIDATION.md for evidence and limits.
The table above records the earlier baseline; these rows are no longer entirely
pending. Multi-account real acceptance, revocation, outage/rate-limit tests,
HubSpot-origin webhook acceptance and continuous scheduling still require evidence.

Both real HubSpot-origin creation and property-change webhook workflows now pass,
including retrieval of the resulting Wix contact and asserted mapped field. A final
Wix echo was ignored and the retryable queue was empty. Continuous scheduling remains
approved but unapplied; see VALIDATION.md. Real multi-account and lifecycle cases
in the original table are still pending.

Automatic one-pair staging acceptance now passes: a new real HubSpot synthetic
contact reached Wix through actual signed ingress and the one-minute scheduled
worker, with zero manual dispatch calls. Both guarded automatic runs and Vault
browser-role denials were verified. Real no-email contact acceptance also passed.
Production alerting and the remaining multi-account/lifecycle cases stay pending.
