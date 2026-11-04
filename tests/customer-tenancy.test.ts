import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { NextRequest } from "next/server";
import { TestDatabase, migratedTestDatabase } from "./support/database";
const m = vi.hoisted(() => ({ db: null as unknown, getUser: vi.fn() }));
vi.mock("../src/lib/supabase/admin", () => ({ getSupabaseAdmin: () => m.db }));
import { requireCustomerUser, requireTenantContext, requireOwnedConnection } from "../src/lib/security/customer-auth";
import { GET, POST } from "../src/app/api/customer/tenants/route";
import { resolveProviderConnections } from "../src/lib/sync/connection-repository";
import { encryptToken } from "../src/lib/security/token-crypto";
import { ProviderFixture } from "./support/providers";
import { GET as overview } from "../src/app/api/customer/overview/route";
import { POST as pairConnections } from "../src/app/api/customer/connections/pair/route";
import { PUT as saveMappings } from "../src/app/api/customer/mappings/route";
import { POST as syncContact } from "../src/app/api/customer/sync/run/route";
import { POST as disconnect } from "../src/app/api/customer/connections/[provider]/disconnect/route";
import { GET as fields } from "../src/app/api/customer/fields/route";
import { GET as operatorOverview } from "../src/app/api/admin/overview/route";
import { POST as connectWix } from "../src/app/api/customer/connections/wix/route";
import { POST as startOAuth } from "../src/app/api/customer/oauth/hubspot/start/route";
import { GET as finishOAuth } from "../src/app/api/customer/oauth/hubspot/callback/route";
import { POST as cancelOAuth } from "../src/app/api/customer/oauth/hubspot/cancel/route";
import { CUSTOMER_STATE_COOKIE } from "../src/lib/providers/hubspot/customer-oauth";
import { saveCustomerConnection } from "../src/lib/providers/customer-connections";
import { createHmac } from "node:crypto";
import { decryptToken } from "../src/lib/security/token-crypto";

const userA = "00000000-0000-4000-8000-000000000001";
const userB = "00000000-0000-4000-8000-000000000002";
const userViewer = "00000000-0000-4000-8000-000000000003";
const wixApp = "10000000-0000-4000-8000-000000000001";
const wixSite = "10000000-0000-4000-8000-000000000002";
const wixOwner = "10000000-0000-4000-8000-000000000003";

describe("verified customer identities and tenant ownership", () => {
  let pg: PGlite; let tenantA: string; let tenantB: string; let providers: ProviderFixture;
  beforeAll(async () => {
    pg = await migratedTestDatabase(); const db = new TestDatabase(pg);
    m.db = { from: db.from.bind(db), rpc: db.rpc.bind(db), auth: { getUser: m.getUser } };
  }, 30000);
  afterAll(async () => pg.close());
  beforeEach(async () => {
    vi.resetAllMocks(); vi.stubEnv("CUSTOMER_ACCESS_ENABLED", "true");
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", "11".repeat(32));
    vi.stubEnv("APP_BASE_URL", "https://sync.example.invalid");
    vi.stubEnv("WIX_APP_ID", wixApp); vi.stubEnv("WIX_APP_SECRET", "synthetic-wix-secret");
    vi.stubEnv("HUBSPOT_CLIENT_ID", "synthetic-hubspot-client"); vi.stubEnv("HUBSPOT_CLIENT_SECRET", "synthetic-hubspot-secret");
    vi.stubEnv("HUBSPOT_CUSTOMER_REDIRECT_URI", "https://sync.example.invalid/api/customer/oauth/hubspot/callback");
    providers = new ProviderFixture(); vi.stubGlobal("fetch", providers.fetch);
    const tables = (await pg.query<{ tablename: string }>("select tablename from pg_tables where schemaname='public'")).rows;
    await pg.exec(`truncate ${tables.map((table) => `public."${table.tablename}"`).join(",")}`);
    const create = async (user: string, name: string) => (await pg.query<{ id: string }>("select public.create_customer_tenant($1,$2) id", [user, name])).rows[0].id;
    tenantA = await create(userA, "Customer A"); tenantB = await create(userB, "Customer B");
    m.getUser.mockImplementation(async (token: string) => {
      const id = token === "token-a" ? userA : token === "token-b" ? userB : token === "token-viewer" ? userViewer : null;
      return { data: { user: id ? { id, email_confirmed_at: "2026-11-03T10:00:00Z", is_anonymous: false } : null }, error: id ? null : new Error("invalid") };
    });
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  const request = (tenant?: string, token = "token-a", method = "GET", body?: string) => new NextRequest("https://sync.example.invalid/api/customer/tenants", {
    method, headers: { authorization: `Bearer ${token}`, ...(tenant ? { "x-tenant-id": tenant } : {}) }, body,
  });
  async function connection(provider: "wix" | "hubspot", account: string, tenant: string | null) {
    return (await pg.query<{ id: string }>("insert into public.provider_connections(provider,external_account_id,tenant_id,encrypted_access_token,token_expires_at) values($1,$2,$3,$4,now()+interval '1 hour') returning id", [provider, account, tenant, encryptToken(`${provider}:${account}`)])).rows[0].id;
  }
  function wixProof(overrides: Record<string, unknown> = {}) {
    const payload = Buffer.from(JSON.stringify({ instanceId: wixSite, uid: wixOwner, siteOwnerId: wixOwner, permissions: "OWNER", appDefId: wixApp, signDate: new Date().toISOString(), ...overrides })).toString("base64url");
    return `${createHmac("sha256", "synthetic-wix-secret").update(payload).digest("base64url")}.${payload}`;
  }
  function onboardingProvider() {
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/oauth2/token-info") {
        const { token } = JSON.parse(String(init?.body)) as { token: string };
        const [signature, data] = token.split(".");
        const active = signature === createHmac("sha256", "synthetic-wix-secret").update(data).digest("base64url");
        return Response.json({ active, clientId: wixApp, instanceId: wixSite, exp: Math.floor(Date.now() / 1000) + 600 });
      }
      if (url.pathname === "/oauth2/token") return Response.json({ access_token: `wix:${wixSite}`, expires_in: 3600 });
      if (url.pathname === "/oauth/2026-03/token") return Response.json({ access_token: "hubspot:100", refresh_token: "synthetic-refresh", expires_in: 3600, hub_id: 100, scopes: ["crm.objects.contacts.read"] });
      return providers.fetch(input, init);
    });
    vi.stubGlobal("fetch", fetcher); return fetcher;
  }
  async function beginOAuth() {
    const response = await startOAuth(request(tenantA, "token-a", "POST"));
    expect(response.status).toBe(200);
    const { authorizationUrl } = await response.json();
    const state = new URL(authorizationUrl).searchParams.get("state")!;
    const nonce = response.cookies.get(CUSTOMER_STATE_COOKIE)!.value;
    return { state, nonce, authorizationUrl };
  }
  function callback(state: string, nonce: string, extra = "code=synthetic-code") {
    return new NextRequest(`https://sync.example.invalid/api/customer/oauth/hubspot/callback?state=${state}&${extra}`, { headers: { cookie: `${CUSTOMER_STATE_COOKIE}=${nonce}` } });
  }

  it("uses a verified Auth user and rejects unverified, anonymous or malformed identities", async () => {
    expect(await requireCustomerUser(request())).toBe(userA);
    expect(m.getUser).toHaveBeenCalledWith("token-a");
    for (const user of [null, { id: "invalid", email_confirmed_at: "date" }, { id: userA }, { id: userA, email_confirmed_at: "date", is_anonymous: true }]) {
      m.getUser.mockResolvedValueOnce({ data: { user }, error: null });
      await expect(requireCustomerUser(request())).rejects.toMatchObject({ status: 401 });
    }
  });
  it("does not accept operator cookies, missing credentials, oversized headers or a disabled feature", async () => {
    for (const header of ["", "Basic token-a", `Bearer ${"a".repeat(17000)}`]) {
      await expect(requireCustomerUser(new Request("https://sync.example.invalid", { headers: { authorization: header, cookie: "wixhub_admin_session=operator" } }))).rejects.toMatchObject({ status: 401 });
    }
    expect(m.getUser).not.toHaveBeenCalled();
    vi.stubEnv("CUSTOMER_ACCESS_ENABLED", "false");
    await expect(requireCustomerUser(request())).rejects.toMatchObject({ status: 503 });
  });
  it("rejects another tenant, missing tenant selections and revoked membership", async () => {
    expect(await requireTenantContext(request(tenantA), true)).toMatchObject({ tenantId: tenantA, userId: userA, role: "owner" });
    await expect(requireTenantContext(request(tenantB))).rejects.toMatchObject({ status: 403 });
    await expect(requireTenantContext(request())).rejects.toMatchObject({ status: 400 });
    await pg.query("delete from public.tenant_memberships where tenant_id=$1 and user_id=$2", [tenantA, userA]);
    await expect(requireTenantContext(request(tenantA))).rejects.toMatchObject({ status: 403 });
  });
  it("allows viewer reads while rejecting writes and disabled tenant access", async () => {
    await pg.query("insert into public.tenant_memberships(tenant_id,user_id,role) values($1,$2,'viewer')", [tenantA, userViewer]);
    expect((await requireTenantContext(request(tenantA, "token-viewer"))).role).toBe("viewer");
    await expect(requireTenantContext(request(tenantA, "token-viewer"), true)).rejects.toMatchObject({ status: 403 });
    await pg.query("update public.tenants set disabled_at=now() where id=$1", [tenantA]);
    await expect(requireTenantContext(request(tenantA))).rejects.toMatchObject({ status: 403 });
  });
  it("checks the connection tenant and provider before returning safe connection metadata", async () => {
    const own = await connection("wix", "site-a", tenantA), other = await connection("wix", "site-b", tenantB);
    const context = await requireTenantContext(request(tenantA));
    expect(await requireOwnedConnection(context, own, "wix")).toMatchObject({ id: own, external_account_id: "site-a" });
    await expect(requireOwnedConnection(context, other)).rejects.toMatchObject({ status: 403 });
    await expect(requireOwnedConnection(context, own, "hubspot")).rejects.toMatchObject({ status: 403 });
    await expect(requireOwnedConnection(context, "invalid")).rejects.toMatchObject({ status: 400 });
  });
  it("lists only a user's active tenants and creates membership atomically", async () => {
    const response = await GET(request());
    expect(await response.json()).toEqual({ tenants: [{ id: tenantA, name: "Customer A", role: "owner" }] });
    const created = await POST(request(undefined, "token-a", "POST", JSON.stringify({ name: "New organization" })));
    expect(created.status).toBe(201);
    const { id } = await created.json();
    expect((await pg.query("select user_id,role from public.tenant_memberships where tenant_id=$1", [id])).rows).toEqual([{ user_id: userA, role: "owner" }]);
    expect((await POST(request(undefined, "token-a", "POST", "{"))).status).toBe(400);
    expect((await POST(request(undefined, "token-a", "POST", JSON.stringify({ name: " " })))).status).toBe(400);
  });
  it("refuses cross-tenant pairs, ownership transfers and inconsistent legacy claims", async () => {
    const wix = await connection("wix", "site-a", tenantA), hubspot = await connection("hubspot", "100", tenantB);
    await expect(pg.query("insert into public.integration_pairs(wix_connection_id,hubspot_connection_id) values($1,$2)", [wix, hubspot])).rejects.toThrow(/same tenant/);
    await expect(pg.query("update public.provider_connections set tenant_id=$1 where id=$2", [tenantB, wix])).rejects.toThrow(/immutable/);
    const legacyWix = await connection("wix", "legacy-site", null), legacyHubSpot = await connection("hubspot", "200", null);
    await pg.query("insert into public.integration_pairs(wix_connection_id,hubspot_connection_id) values($1,$2)", [legacyWix, legacyHubSpot]);
    await pg.query("update public.provider_connections set tenant_id=$1 where id=$2", [tenantA, legacyWix]);
    await expect(resolveProviderConnections("legacy-site")).rejects.toThrow(/ownership/);
    await expect(pg.query("update public.provider_connections set tenant_id=$1 where id=$2", [tenantB, legacyHubSpot])).rejects.toThrow(/same tenant/);
    await pg.query("update public.provider_connections set tenant_id=$1 where id=$2", [tenantA, legacyHubSpot]);
    expect((await resolveProviderConnections("legacy-site")).hubspot.id).toBe(legacyHubSpot);
    await pg.query("update public.tenants set disabled_at=now() where id=$1", [tenantA]);
    await expect(resolveProviderConnections("legacy-site")).rejects.toThrow(/unavailable/);
  });
  it("denies browser roles direct tenant access and privileged creation RPC execution", async () => {
    for (const role of ["anon", "authenticated"]) {
      await pg.exec(`set role ${role}`);
      try {
        await expect(pg.query("select * from public.tenants")).rejects.toThrow(/permission denied/);
        await expect(pg.query("select * from public.tenant_memberships")).rejects.toThrow(/permission denied/);
        await expect(pg.query("select public.create_customer_tenant($1,'Unauthorized')", [userA])).rejects.toThrow(/permission denied/);
      } finally { await pg.exec("reset role"); }
    }
  });
  it("scopes customer overview events, mappings and audit history without exposing credentials", async () => {
    const wixA = await connection("wix", "site-a", tenantA), hubspotA = await connection("hubspot", "100", tenantA);
    const wixB = await connection("wix", "site-b", tenantB), hubspotB = await connection("hubspot", "200", tenantB);
    for (const [wix, hubspot] of [[wixA, hubspotA], [wixB, hubspotB]]) {
      await pg.query("insert into public.integration_pairs(wix_connection_id,hubspot_connection_id) values($1,$2)", [wix, hubspot]);
      await pg.query("select public.replace_field_mappings($1,$2,$3::jsonb)", [wix, hubspot, JSON.stringify([{ wixField: "info.name.first", hubspotProperty: "firstname", direction: "bidirectional" }])]);
      await pg.query("insert into public.sync_audit_logs(provider,action,outcome,wix_connection_id,hubspot_connection_id) values('wix','contact_sync','succeeded',$1,$2)", [wix, hubspot]);
    }
    await pg.exec("insert into public.webhook_events(provider,event_type,idempotency_key,external_account_id) values('wix','contact','a','site-a'),('wix','contact','b','site-b'),('hubspot','contact','c','100'),('hubspot','contact','d','200')");
    const response = await overview(request(tenantA)); const result = await response.json();
    expect(response.status).toBe(200); expect(result.connections.map((row: { id: string }) => row.id).sort()).toEqual([wixA, hubspotA].sort());
    expect(result.pairs).toHaveLength(1); expect(result.mappings).toHaveLength(1); expect(result.recentActivity).toHaveLength(1); expect(result.recentEvents).toHaveLength(2);
    expect(JSON.stringify(result)).not.toContain("site-b"); expect(JSON.stringify(result)).not.toContain("encrypted_access_token");
    expect((await operatorOverview(request(tenantA))).status).toBe(401);
  });
  it("rejects cross-tenant pairing and preserves the owner's connection when another user disconnects", async () => {
    const wixA = await connection("wix", "site-a", tenantA), hubspotB = await connection("hubspot", "200", tenantB);
    expect((await pairConnections(request(tenantA, "token-a", "POST", JSON.stringify({ wixConnectionId: wixA, hubspotConnectionId: hubspotB })))).status).toBe(403);
    expect((await disconnect(request(tenantB, "token-b", "POST", JSON.stringify({ externalAccountId: "site-a" })), { params: Promise.resolve({ provider: "wix" }) })).status).toBe(403);
    expect((await pg.query<{ disconnected_at: null }>("select disconnected_at from public.provider_connections where id=$1", [wixA])).rows[0].disconnected_at).toBeNull();
  });
  it("allows only owned pairs to save mappings and synchronize contacts", async () => {
    const wix = await connection("wix", "site-a", tenantA), hubspot = await connection("hubspot", "100", tenantA);
    expect((await pairConnections(request(tenantA, "token-a", "POST", JSON.stringify({ wixConnectionId: wix, hubspotConnectionId: hubspot })))).status).toBe(201);
    const pairId = (await pg.query<{ id: string }>("select id from public.integration_pairs where wix_connection_id=$1", [wix])).rows[0].id;
    const mapping = { instanceId: "site-a", pairId, mappings: [{ wixField: "info.name.first", hubspotProperty: "nickname", direction: "bidirectional", transform: "uppercase" }] };
    expect((await saveMappings(request(tenantB, "token-b", "PUT", JSON.stringify(mapping)))).status).toBe(403);
    expect((await saveMappings(request(tenantA, "token-a", "PUT", JSON.stringify(mapping)))).status).toBe(200);
    providers.addWix("site-a");
    const input = { provider: "wix", instanceId: "site-a", pairId, contactId: "source" };
    expect((await syncContact(request(tenantB, "token-b", "POST", JSON.stringify(input)))).status).toBe(403);
    expect(providers.writes).toHaveLength(0);
    expect((await syncContact(request(tenantA, "token-a", "POST", JSON.stringify(input)))).status).toBe(200);
    expect([...providers.hubspot.get("100")!.values()][0].properties).toMatchObject({ nickname: "ADA", email: "same@example.invalid" });
  });
  it("denies viewer mutations and foreign portal metadata before provider requests", async () => {
    const wix = await connection("wix", "site-a", tenantA), hubspot = await connection("hubspot", "100", tenantA), foreign = await connection("hubspot", "200", tenantB);
    await pg.query("update public.tenant_memberships set role='viewer' where tenant_id=$1 and user_id=$2", [tenantA, userA]);
    expect((await pairConnections(request(tenantA, "token-a", "POST", JSON.stringify({ wixConnectionId: wix, hubspotConnectionId: hubspot })))).status).toBe(403);
    const forbidden = request(tenantA); forbidden.nextUrl.searchParams.set("connectionId", foreign);
    expect((await fields(forbidden)).status).toBe(403);
    const allowed = request(tenantA); allowed.nextUrl.searchParams.set("connectionId", hubspot);
    expect((await fields(allowed)).status).toBe(200);
  });
  it("requires a verified owner context for Wix and never accepts a raw customer instance ID", async () => {
    const fetcher = onboardingProvider();
    expect((await connectWix(request(tenantA, "token-a", "POST", JSON.stringify({ instanceId: wixSite })))).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
    const connected = await connectWix(request(tenantA, "token-a", "POST", JSON.stringify({ instance: wixProof() })));
    expect(connected.status).toBe(200);
    expect(JSON.stringify(await connected.json())).not.toContain("access_token");
    const row = (await pg.query<{ tenant_id: string; encrypted_access_token: string }>("select * from public.provider_connections where external_account_id=$1", [wixSite])).rows[0];
    expect(row.tenant_id).toBe(tenantA); expect(decryptToken(row.encrypted_access_token)).toBe(`wix:${wixSite}`);
    expect(fetcher.mock.calls[0][0]).toBe("https://www.wixapis.com/oauth2/token-info");
  });
  it.each([
    { permissions: "MEMBER" }, { uid: userB }, { aid: "anonymous" }, { appDefId: "different-app" },
    { signDate: "invalid" }, { signDate: "2020-01-01T00:00:00Z" },
  ])("rejects unsafe Wix owner claims before token generation (%j)", async (claims) => {
    const fetcher = onboardingProvider();
    expect((await connectWix(request(tenantA, "token-a", "POST", JSON.stringify({ instance: wixProof(claims) })))).status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects a modified Wix signature through provider introspection", async () => {
    const fetcher = onboardingProvider(); const proof = wixProof();
    const signature = Buffer.from(proof.split(".")[0], "base64url"); signature[0] ^= 1;
    const altered = `${signature.toString("base64url")}.${proof.split(".")[1]}`;
    expect((await connectWix(request(tenantA, "token-a", "POST", JSON.stringify({ instance: altered })))).status).toBe(403);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await pg.query("select * from public.provider_connections")).rows).toHaveLength(0);
  });
  it("binds customer OAuth to an independent browser nonce and consumes it once", async () => {
    const fetcher = onboardingProvider(); const flow = await beginOAuth();
    expect(flow.nonce).not.toBe(flow.state);
    expect(new URL(flow.authorizationUrl).searchParams.get("redirect_uri")).toBe("https://sync.example.invalid/api/customer/oauth/hubspot/callback");
    const row = (await pg.query<{ state_hash: string; encrypted_user_token: string }>("select * from public.customer_oauth_states")).rows[0];
    expect(row.state_hash).not.toBe(flow.state); expect(decryptToken(row.encrypted_user_token)).toBe("token-a");
    const forged = await finishOAuth(callback(flow.state, flow.state));
    expect(forged.status).toBe(400); expect(forged.cookies.get(CUSTOMER_STATE_COOKIE)).toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();
    const completed = await finishOAuth(callback(flow.state, flow.nonce));
    expect(completed.status).toBe(307); expect(completed.headers.get("location")).toContain("hubspot-connected");
    expect((await finishOAuth(callback(flow.state, flow.nonce))).status).toBe(400);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await pg.query("select tenant_id from public.provider_connections")).rows).toEqual([{ tenant_id: tenantA }]);
  });
  it("rechecks membership and the authenticated user before exchanging customer OAuth codes", async () => {
    const fetcher = onboardingProvider(); const flow = await beginOAuth();
    await pg.query("delete from public.tenant_memberships where tenant_id=$1 and user_id=$2", [tenantA, userA]);
    expect((await finishOAuth(callback(flow.state, flow.nonce))).status).toBe(403); expect(fetcher).not.toHaveBeenCalled();
    await pg.query("insert into public.tenant_memberships(tenant_id,user_id,role) values($1,$2,'owner')", [tenantA, userA]);
    const second = await beginOAuth();
    m.getUser.mockResolvedValueOnce({ data: { user: null }, error: new Error("expired session") });
    expect((await finishOAuth(callback(second.state, second.nonce))).status).toBe(403); expect(fetcher).not.toHaveBeenCalled();
  });
  it("prevents OAuth from replacing another tenant's provider credentials", async () => {
    onboardingProvider();
    await saveCustomerConnection({ userId: userB, tenantId: tenantB }, { provider: "hubspot", accountId: "100", label: "Existing portal", accessToken: "original-token", refreshToken: "original-refresh", expiresIn: 3600 });
    const flow = await beginOAuth();
    expect((await finishOAuth(callback(flow.state, flow.nonce))).status).toBe(409);
    const row = (await pg.query<{ tenant_id: string; encrypted_access_token: string }>("select * from public.provider_connections")).rows[0];
    expect(row.tenant_id).toBe(tenantB); expect(decryptToken(row.encrypted_access_token)).toBe("original-token");
  });
  it("expires customer state, handles denial, and cancels pending consent on logout", async () => {
    const fetcher = onboardingProvider(); const expired = await beginOAuth();
    await pg.exec("update public.customer_oauth_states set expires_at=now()-interval '1 second'");
    expect((await finishOAuth(callback(expired.state, expired.nonce))).status).toBe(400);
    const denied = await beginOAuth();
    expect((await finishOAuth(callback(denied.state, denied.nonce, "error=access_denied"))).headers.get("location")).toContain("connection=denied");
    const pending = await beginOAuth();
    const cancellation = await cancelOAuth(new NextRequest("https://sync.example.invalid/api/customer/oauth/hubspot/cancel", { method: "POST", headers: { origin: "https://sync.example.invalid", cookie: `${CUSTOMER_STATE_COOKIE}=${pending.nonce}` } }));
    expect(cancellation.status).toBe(200);
    expect((await finishOAuth(callback(pending.state, pending.nonce))).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("serializes competing ownership claims and refuses a forged viewer write context", async () => {
    const input = { provider: "hubspot" as const, accountId: "100", label: "Portal", accessToken: "token", expiresIn: 3600 };
    const results = await Promise.allSettled([saveCustomerConnection({ userId: userA, tenantId: tenantA }, input), saveCustomerConnection({ userId: userB, tenantId: tenantB }, input)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect((await pg.query("select * from public.provider_connections")).rows).toHaveLength(1);
    await pg.query("update public.tenant_memberships set role='viewer' where tenant_id=$1", [tenantA]);
    await expect(saveCustomerConnection({ userId: userA, tenantId: tenantA }, { ...input, accountId: "200" })).rejects.toMatchObject({ status: 409 });
  });
});
