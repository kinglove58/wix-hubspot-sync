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
| Customer access lacked ownership authorization | P1 | Separate verified Supabase Auth namespace, active membership/role checks, scoped resources and immutable connection ownership; SQL, route and browser regressions |
| Customer OAuth identity or tenant substitution | P1 | Independent private browser nonce plus single-use state hashes, encrypted short-lived user token, fresh Auth and membership verification before exchange, atomic ownership save |
| Customer Wix instance guessing | P1 | Owner-only signed context validated through official Wix Token Info; raw site IDs rejected before provider effects |
| Reconnection could overtake a persisted unfinished uninstall | P1 | SQL activation barrier plus fail-closed sync resolution; pending/processing/failed, bootstrap, refresh, account scope and receiver-crash workflow tests |
| Lifecycle effect could receive a mismatched account argument | P1 | Removal transaction checks persisted verified account metadata before changing credentials; SQL regression preserves the unrelated site |

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

* P1: Verify the new customer Auth, ownership proof and OAuth flows with real staging
  accounts before enabling `CUSTOMER_ACCESS_ENABLED`. Mocked Auth/provider HTTP cannot
  establish live consent, email delivery or Wix dashboard context behavior.
* P1: HubSpot has no verified atomic conditional contact PATCH contract. A final-read
  preflight reduces stale writes but cannot eliminate edits racing the write.
* P1: Complete provider installation, revocation/lifecycle acceptance and continuous
  scheduler verification in isolated staging. All 20 migrations, live RLS/grant and
  PostgREST checks now pass; multi-session behavior remains a separate release gate.
* P2: Multi-process fault injection, retention policies, key rotation, restore exercises
  and ingress throttling. Sync/security coverage targets are met; provider/queue
  boundary coverage still has room to improve.

Do not accept real customer data until release owners resolve the applicable P1 gates.
No production penetration test or external security certification is claimed. Real isolated QA contact/webhook and automatic-processing evidence is recorded in VALIDATION.md; it does not certify production or the broader multi-account/lifecycle matrix.
Dependency audit results belong in the dated validation record.

Report vulnerabilities privately to the repository owner. Do not put tokens, contact
payloads, OAuth codes or database credentials in issues or logs. Rotation of the
encryption key requires a deliberate re-encryption migration; changing it in place
will make existing encrypted records unreadable.

### Staging scheduler security

The final staging Cron job reads its credential from protected Vault and uses
synchronous `extensions.http`. It never queues that credential in pg_net. Live
inspection found pg_net queue/function grants to browser DB roles that broad
revocations did not remove; public Data API access to net independently returns
406/PGRST106. The exploratory extension remains unused by the final job. Vault
schema usage and decrypted-secret reads are denied to anon/authenticated and were
verified after setup. Internal Supabase-owned crypto helper grants are untouched.
The job validates HTTP200 and zero failed/deferred counts and emits count-only logs.
This is staging verification, not a production security certification.
