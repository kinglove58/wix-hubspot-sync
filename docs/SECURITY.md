# Security assessment and release conditions

## Implemented controls

| Finding | Priority | Remediation and evidence |
|---|---|---|
| Arbitrary destination resolution could cross account boundaries | P0 | Explicit pairs, pair-scoped queries/constraints, shared-account workflow regression tests |
| Replayable OAuth state | P1 | Random 256-bit state, hashed ten-minute DB storage, atomic single-use consumption, callback and SQL lifecycle tests |
| Worker takeover could complete another claim | P1 | Independent lease generation, owner/deadline checks and fenced completion; SQL and service tests |
| Uncertain creates could be repeated | P1 | Durable creation intents and reconciliation; SQL-backed workflow and fault tests |
| Null mappings could clear customer fields | P1 | Default merging and explicit `allowEmpty`; mapping regressions |
| Disconnected installations could resume | P1 | Durable tombstones and transactional uninstall; lifecycle workflow tests |
| Unbounded or repeated permanent failures | P1 | Bounded attempts, backoff, terminal state, stale recovery and rate-limit tests |
| Delayed Forms could replace newer contact edits or bypass disabled mappings | P1 | Immutable provider timestamps, fresh target preflight, shared mapping masks and SQL-backed regression workflow |
| Secret/PII exposure | P1 | Server-only Supabase client, authenticated encryption, metadata-only logs, no provider bodies in safe HTTP errors |
| Public administrative mutations | P1 | Signed HttpOnly sessions or server API credential, same-origin cookie mutations, durable login limit |

Wix verifies RS256 before decoding nested data and requires numeric unexpired `exp`;
`iat`, when supplied, is validated. The verifier does not invent a requirement for
an optional provider claim. HubSpot requires raw-body v3 HMAC, canonical public URL
and a five-minute timestamp window. Durable deduplication supplements freshness checks.

Tokens and webhook payloads use Node's established AES-256-GCM implementation with
random nonces and authenticated envelopes. Keys must decode canonically to 32 bytes.
Encryption keys and service-role credentials stay in server-only environment values.
RLS and privilege revocation deny browser database access; no permissive public policy
was introduced. SQL claim/lease functions are restricted to trusted backend roles.

## Open release conditions

* P1: Shared operator authorization is unsuitable for customer self-service. Add
  user/tenant membership and explicit resource authorization before that product mode.
* P1: HubSpot has no verified atomic conditional contact PATCH contract. A final-read
  preflight reduces stale writes but cannot eliminate edits racing the write.
* P1: Apply and verify migrations, provider configuration and production scheduler in
  controlled staging. PGlite does not verify deployed Supabase/PostgREST behavior.
* P2: Multi-process fault injection, retention policies, key rotation, restore exercises
  and ingress throttling. Sync/security coverage targets are met; provider/queue
  boundary coverage still has room to improve.

Do not accept real customer data until release owners resolve the applicable P1 gates.
No production penetration test, external security certification or live provider
acceptance is claimed. Dependency audit results belong in the dated validation record.

Report vulnerabilities privately to the repository owner. Do not put tokens, contact
payloads, OAuth codes or database credentials in issues or logs. Rotation of the
encryption key requires a deliberate re-encryption migration; changing it in place
will make existing encrypted records unreadable.
