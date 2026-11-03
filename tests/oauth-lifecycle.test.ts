import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { migratedTestDatabase, TestDatabase } from "./support/database";
const mocks = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../src/lib/supabase/admin", () => ({ getSupabaseAdmin: () => mocks.db }));
import { createOAuthState, storeOAuthState, consumeOAuthState, safeCompareState, buildHubSpotAuthorizationUrl, exchangeHubSpotCode } from "../src/lib/providers/hubspot/oauth";
import { hubspotRequest } from "../src/lib/providers/hubspot/client";
import { decryptToken, encryptToken } from "../src/lib/security/token-crypto";
import { saveProviderConnection, getProviderConnection, disconnectProvider } from "../src/lib/providers/connections";

describe("OAuth lifecycle against PostgreSQL with synthetic provider responses", () => {
  let pg: PGlite;
  beforeAll(async () => { pg = await migratedTestDatabase(); mocks.db = new TestDatabase(pg); }, 30000);
  afterAll(async () => pg.close());
  beforeEach(async () => {
    await pg.exec("truncate public.provider_connections cascade; truncate public.oauth_states; truncate public.integration_leases;");
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", "11".repeat(32));
    vi.stubEnv("HUBSPOT_CLIENT_ID", "synthetic-client");
    vi.stubEnv("HUBSPOT_CLIENT_SECRET", "synthetic-secret");
    vi.stubEnv("HUBSPOT_REDIRECT_URI", "https://sync.example.invalid/api/oauth/hubspot/callback");
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("stores only state hashes, consumes once, and rejects expired state", async () => {
    const state = createOAuthState();
    expect(state).not.toBe(createOAuthState());
    expect(safeCompareState(state, state)).toBe(true);
    expect(safeCompareState(state, "wrong")).toBe(false);
    await storeOAuthState(state);
    expect(JSON.stringify((await pg.query("select * from public.oauth_states")).rows)).not.toContain(state);
    expect(await consumeOAuthState(state)).toBe(true);
    expect(await consumeOAuthState(state)).toBe(false);
    await storeOAuthState(state);
    await pg.exec("update public.oauth_states set expires_at=now()-interval '1 minute'");
    expect(await consumeOAuthState(state)).toBe(false);
    const url = new URL(buildHubSpotAuthorizationUrl(state));
    expect(url.searchParams.get("state")).toBe(state);
    expect(url.searchParams.get("scope")).toContain("crm.objects.contacts.write");
  });

  it("validates exchange responses, encrypts credentials, and reconnects the same portal", async () => {
    const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ access_token: "synthetic-access", refresh_token: "synthetic-refresh", expires_in: 1800, hub_id: 100, scopes: ["crm.objects.contacts.read"] })));
    vi.stubGlobal("fetch", fetcher);
    await exchangeHubSpotCode("synthetic-code");
    const row = (await pg.query<{ id: string; encrypted_access_token: string }>("select * from public.provider_connections")).rows[0];
    expect(decryptToken(row.encrypted_access_token)).toBe("synthetic-access");
    expect(row.encrypted_access_token).not.toContain("synthetic-access");
    const body = fetcher.mock.calls[0][1].body as URLSearchParams;
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("synthetic-code");
    await pg.exec("update public.provider_connections set disconnected_at=now()");
    await exchangeHubSpotCode("reconnect-code");
    expect((await pg.query<{ id: string; disconnected_at: null }>("select * from public.provider_connections")).rows).toEqual([expect.objectContaining({ id: row.id, disconnected_at: null })]);
    fetcher.mockResolvedValueOnce(new Response("{}", { status: 400 }));
    await expect(exchangeHubSpotCode("invalid-code")).rejects.toThrow(/400/);
    fetcher.mockResolvedValueOnce(new Response("{}"));
    await expect(exchangeHubSpotCode("invalid-response")).rejects.toThrow();
  });

  async function connection(expired = true) {
    const result = await pg.query<{ id: string }>("insert into public.provider_connections(provider,external_account_id,encrypted_access_token,encrypted_refresh_token,token_expires_at) values ('hubspot','100',$1,$2,$3) returning id", [encryptToken("old-access"), encryptToken("old-refresh"), new Date(Date.now() + (expired ? -60000 : 3600000)).toISOString()]);
    return result.rows[0].id;
  }

  it("refreshes expired credentials, persists rotated refresh tokens and sends the new access token", async () => {
    const id = await connection();
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 1800 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "contact" })));
    vi.stubGlobal("fetch", fetcher);
    expect(await hubspotRequest("/synthetic", {}, id)).toEqual({ id: "contact" });
    expect(fetcher.mock.calls[1][1].headers.authorization).toBe("Bearer new-access");
    const row = (await pg.query<{ encrypted_refresh_token: string }>("select * from public.provider_connections")).rows[0];
    expect(decryptToken(row.encrypted_refresh_token)).toBe("new-refresh");
  });

  it("refreshes once after 401 and stops using a revoked connection", async () => {
    const id = await connection(false);
    const fetcher = vi.fn().mockResolvedValueOnce(new Response("{}", { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "new-access", expires_in: 1800 })))
      .mockResolvedValueOnce(new Response("{}", { status: 401 }));
    vi.stubGlobal("fetch", fetcher);
    await expect(hubspotRequest("/synthetic", {}, id)).rejects.toThrow(/401/);
    expect(fetcher).toHaveBeenCalledTimes(3);
    await pg.exec("update public.provider_connections set token_expires_at=now()-interval '1 minute'");
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }));
    await expect(hubspotRequest("/synthetic", {}, id)).rejects.toThrow();
    const row = (await pg.query<{ disconnected_at: string; encrypted_access_token: null }>("select * from public.provider_connections")).rows[0];
    expect(row.disconnected_at).toBeTruthy();
    expect(row.encrypted_access_token).toBeNull();
    const count = fetcher.mock.calls.length;
    await expect(hubspotRequest("/synthetic", {}, id)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(count);
  });

  it("stores installation credentials encrypted, resolves only active accounts and preserves disconnected history", async () => {
    const saved = await saveProviderConnection({ provider: "wix", externalAccountId: "site-a", accessToken: "synthetic-wix", expiresIn: 3600 });
    expect(saved).not.toHaveProperty("encrypted_access_token");
    expect((await getProviderConnection("wix", "site-a"))?.accessToken).toBe("synthetic-wix");
    await disconnectProvider("wix", "site-a");
    expect(await getProviderConnection("wix", "site-a")).toBeNull();
    const row = (await pg.query<{ id: string; encrypted_access_token: null }>("select * from public.provider_connections")).rows[0];
    expect(row.id).toBe(saved.id); expect(row.encrypted_access_token).toBeNull();
    await saveProviderConnection({ provider: "wix", externalAccountId: "site-a", accessToken: "reconnected" });
    expect((await getProviderConnection("wix", "site-a"))?.id).toBe(saved.id);
  });

  it("disables locally before remote revocation, even if the provider is unavailable", async () => {
    const id = await connection(false);
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      expect(await getProviderConnection("hubspot", "100")).toBeNull();
      expect((init.body as URLSearchParams).get("token")).toBe("old-refresh");
      return new Response("{}", { status: 503 });
    });
    vi.stubGlobal("fetch", fetcher);
    await expect(disconnectProvider("hubspot", "100")).rejects.toThrow(/disabled locally/);
    expect((await pg.query<{ id: string; disconnected_at: string }>("select * from public.provider_connections")).rows[0]).toMatchObject({ id, disconnected_at: expect.any(Date) });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects ambiguous unscoped metadata lookup and revokes the selected portal only", async () => {
    await connection(false);
    await saveProviderConnection({ provider: "hubspot", externalAccountId: "200", accessToken: "other", refreshToken: "other-refresh", scopes: ["crm.objects.contacts.read"] });
    await expect(getProviderConnection("hubspot")).rejects.toThrow(/load provider/);
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetcher);
    await disconnectProvider("hubspot", "200");
    expect(await getProviderConnection("hubspot", "100")).not.toBeNull();
    expect(await getProviderConnection("hubspot", "200")).toBeNull();
    expect(fetcher.mock.calls[0][0]).toBe("https://api.hubapi.com/oauth/2026-03/token/revoke");
  });
});
