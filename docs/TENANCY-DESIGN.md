# Customer tenancy and onboarding

The optional `/customer` workspace and `/api/customer` routes are implemented and
tested locally with synthetic Auth/provider HTTP. They remain disabled by default.
No real Supabase Auth, Wix ownership proof or customer consent flow has been accepted
against development accounts. The root console remains a privileged operator path;
never distribute its credentials to customers.

## Identity and authorization

Supabase Auth manages email/password accounts and browser session refresh using the
existing SDK with PKCE. Require confirmed email and reject anonymous accounts. Every
server request calls `auth.getUser(accessToken)`, never authorizing from browser
identity fields, decoded JWT claims or cached `getSession` data. The customer Auth
JWT belongs in the customer's browser; Wix/HubSpot credentials never do.

`X-Tenant-ID` selects an organization. The server checks current membership and active
tenant status on every request. Owners/admins may change integrations; viewers only
read. Resource checks cover both pair endpoints, provider account IDs, mapping writes,
manual sync, metadata, history and disconnect. Customer tokens cannot authorize the
operator API. Organization creation atomically creates its owner membership. Membership
administration currently requires a trusted operator; there is no invitation UI.

Integration tables and privileged functions remain inaccessible to browser database
roles. Server-only Supabase access uses `SUPABASE_SECRET_KEY`, with legacy
`SUPABASE_SERVICE_ROLE_KEY` as fallback. The public configuration rejects known secret
key classes and keys equal to configured backend credentials. Decoding legacy `anon`
key metadata is configuration validation only, never authentication.

## Ownership and routing

The two additive `20261103000000_customer_tenancy` and
`20261103000001_customer_onboarding` migrations add tenants, memberships, nullable
connection ownership, scoped event account metadata and customer consent state.
Unassigned legacy connections remain operator-only until a customer proves provider
control. No automatic owner backfill occurs. Reconnection preserves IDs and history;
an assigned provider account cannot silently move to a different tenant.

SQL ownership assignment and pair validation lock endpoint rows. Competing claims
cannot replace another tenant's credentials. Paired endpoints must share ownership.
Partially adopted legacy pairs stop syncing until both endpoints are reconciled to
the same tenant; never guess their owner. Both unassigned endpoints retain operator
behavior. Disabled tenants stop background synchronization. Historical events lacking
the new account metadata remain operator-only rather than being exposed speculatively.

## Wix ownership proof

Configure Wix's **external, top-level dashboard Open App URL** as
`https://STAGING_HOST/customer`. Wix must append signed app instance context. The app
rejects framing with CSP and X-Frame-Options; do not embed this workspace in an iframe.
Open as the site owner, sign in to the customer account, select the intended organization
and press Connect Wix site within ten minutes. The context is kept in memory and
removed from the address bar; refresh or expired context requires reopening from Wix.

The server rejects raw instance IDs. It validates the canonical signed envelope,
owner identity, installation/app IDs and freshness, then calls Wix's official
`POST /oauth2/token-info` to verify the signature and active matching app/installation.
Local parsing alone never authorizes ownership. Contributor/member or anonymous context
is rejected. Only after verification does the server obtain instance credentials and
atomically claim the connection. A legitimate site owner must not share this proof.
Wix site transfers and reinstall/delayed lifecycle events require staging acceptance;
the instance ID may survive reinstall and does not itself prove current ownership.

Migration `20261104000000_pending_wix_removal_barrier` blocks token activation,
reconnection and synchronization while an already-persisted removal remains unfinished.
Process that removal before reconnecting; do not delete or mark it successful merely
to bypass the barrier. A legacy removal without account metadata blocks all Wix sites
until its encrypted payload is safely processed. Failed/terminal removals require
operator investigation. No occurrence order is inferred from JWT `iat` or arrival time.
A first delivery arriving after reconnection still disables the installation safely;
automatic recovery from that case requires verified provider lifecycle semantics.

Official references: [signed app instance validation](https://dev.wix.com/docs/build-apps/develop-your-app/auth/app-instances/parse-the-app-instance-query-parameter),
[Token Info](https://dev.wix.com/docs/api-reference/app-management/oauth-2/token-info),
[app instance lifecycle](https://dev.wix.com/docs/build-apps/develop-your-app/auth/app-instances/about-app-instances).
The [legacy removal event](https://dev.wix.com/docs/api-reference/app-management/app-instance/app-instance-removed)
documents delayed delivery without a usable occurrence timestamp in its event schema.

## HubSpot consent binding

Customer consent uses a distinct callback `/api/customer/oauth/hubspot/callback`.
Starting consent requires a verified user and write membership. A random URL state
and an independent private HttpOnly browser nonce are hashed in the database. The
private cookie is never the URL state. Records expire after ten minutes; expired rows
are removed on subsequent starts. A short-lived encrypted copy of the initial customer
Auth token lets the callback revalidate the actual user with Auth before exchanging
the provider code. Membership is rechecked before exchange and inside ownership save.

Callback consumption atomically matches both hashes and expiry. Replay, mismatched
browser, expired session, revoked membership and cross-tenant provider claims fail
closed. Sign-out cancels pending consent with same-origin protection and the private
cookie before clearing the local customer session. A failed cancellation is reported,
so the UI does not falsely claim sign-out succeeded. Session revocation/expiry at the
Auth provider also prevents completion. No provider credentials enter a callback URL
or browser response. Only same-origin exact customer callback paths are accepted;
production callbacks require HTTPS.

## Exact staging setup and acceptance

1. Apply all reviewed migrations to an isolated Supabase project and verify grants,
   RLS, functions and constraints. Use a modern server secret key in host settings.
2. Enable Supabase Auth email/password with **email confirmation enabled**, appropriate
   password/rate-limit policies, SMTP/email delivery and Site URL matching staging.
   Add `https://STAGING_HOST/customer` to allowed redirects. Configure abuse/CAPTCHA
   and email-delivery monitoring before public signup. Never weaken confirmation.
3. Set `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to that project's public key; legacy
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` is supported. Never place a secret/service key there.
   See [Supabase API key guidance](https://supabase.com/docs/guides/getting-started/api-keys).
4. Register the exact HTTPS customer callback in HubSpot in addition to the operator
   callback. Set `HUBSPOT_CUSTOMER_REDIRECT_URI` if needed; the default derives from
   `APP_BASE_URL`. Configure the Wix external dashboard URL above.
5. Enable `CUSTOMER_ACCESS_ENABLED=true` **in staging only**. Verify signup/email,
   login/refresh/logout, organization creation and revoked/viewer membership. Connect
   each provider through its actual proof/consent flow, pair them and run the full
   multi-account acceptance matrix. Test two users, foreign IDs, competing claims,
   legacy adoption, disabled tenants, expiry, replay, denial and disconnect/reconnect.
6. Retain sanitized evidence and resolve all release gates before requesting production
   activation. No remote setup, real email or provider acceptance is claimed here.
