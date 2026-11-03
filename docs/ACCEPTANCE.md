# Acceptance matrix

All evidence below is local automated verification with synthetic provider HTTP or
isolated PostgreSQL. **Every live-provider/staging acceptance row remains pending.**
This table does not convert test coverage into production certification.

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
| Echo prevention | Exact provider versions, precision/time-zone and newer-edit tests | Live timestamp precision and webhook ordering |
| Worker crash / stale lease | SQL reclaim, independent completion fencing, owner/deadline checks | Multiple processes, forced termination and long suspension |
| Retry limit / permanent errors | 100% retry-policy branches, exhausted lease and terminal workflow | Deployed scheduler sweeps and alerts |
| Partial mapping | Defaults retained, empty/null opt-in, one-way masks | Portal-specific fields and Wix geographic values |
| Delayed or disabled Forms | Timestamp preflight, mapping masks, schema bounds and audit/link failure tests | Actual site submission timestamps and field IDs |
| Same IDs/emails across accounts | Pair-scoped SQL workflow; shared destinations explicit | Independent real test-account verification |
| Concurrent events | Two simultaneous processing calls create one destination identity | Multi-process/load fault injection |

Before production, retain sanitized request/event IDs and observed outcomes, verify
backups/restores and retention rules, and resolve the P1 gates in `ENGINEERING-REPORT.md`.
