import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ admin: vi.fn(), decrypt: vi.fn() }));
vi.mock("../src/lib/supabase/admin", () => ({ getSupabaseAdmin: m.admin }));
vi.mock("../src/lib/security/token-crypto", () => ({ decryptToken: m.decrypt, encryptToken: vi.fn() }));
import { createHubSpotContact, getHubSpotContact, hubspotRequest, updateHubSpotContact } from "../src/lib/providers/hubspot/client";

describe("HubSpot account-scoped requests", () => {
  const fetchMock = vi.fn<typeof fetch>();
  const eq = vi.fn();
  let unavailable = false;
  beforeEach(() => {
    vi.clearAllMocks(); unavailable = false;
    const query = { select: vi.fn().mockReturnThis(), eq: eq.mockReturnThis(), is: vi.fn().mockReturnThis(), maybeSingle: vi.fn(async () => unavailable
      ? { data: null, error: { message: "multiple connections" } }
      : { data: { id: "portal-a", encrypted_access_token: "encrypted-a", token_expires_at: new Date(Date.now() + 3600_000).toISOString() }, error: null }) };
    m.admin.mockReturnValue({ from: vi.fn().mockReturnValue(query) });
    m.decrypt.mockReturnValue("portal-a-token");
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("selects credentials by explicit connection ID and sets a timeout", async () => {
    fetchMock.mockResolvedValue(Response.json({ id: "contact" }));
    await hubspotRequest("/test", {}, "portal-a");
    expect(eq).toHaveBeenCalledWith("id", "portal-a");
    expect(fetchMock).toHaveBeenCalledWith("https://api.hubapi.com/test", expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer portal-a-token" }), signal: expect.any(AbortSignal) }));
  });

  it("fails closed when a portal cannot be resolved", async () => {
    unavailable = true;
    await expect(hubspotRequest("/test")).rejects.toThrow(/not connected/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("checks property availability and rejects a read-only write", async () => {
    fetchMock.mockResolvedValue(Response.json({ results: [{ name: "email", modificationMetadata: { readOnlyValue: true } }] }));
    await expect(createHubSpotContact({ email: "test@example.invalid" }, "portal-a")).rejects.toThrow(/read-only/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("loads available default fields and refuses missing configured properties", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ results: [{ name: "email" }] }))
      .mockResolvedValueOnce(Response.json({ id: "contact", properties: { email: "test@example.invalid" } }));
    expect((await getHubSpotContact("contact", [], "portal-a")).id).toBe("contact");
    expect(String(fetchMock.mock.calls[1][0])).toContain("properties=email");
    fetchMock.mockResolvedValueOnce(Response.json({ results: [{ name: "email" }] }));
    await expect(getHubSpotContact("contact", ["unavailable_custom_field"], "portal-a")).rejects.toThrow(/unavailable/);
  });

  it("preserves Retry-After on rate limits and refuses malformed contact envelopes", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 429, headers: { "Retry-After": "120" } }));
    await expect(hubspotRequest("/test", {}, "portal-a")).rejects.toMatchObject({ status: 429, retryAfterSeconds: 120 });
    fetchMock.mockResolvedValueOnce(Response.json({ results: [{ name: "email" }] })).mockResolvedValueOnce(Response.json({ id: 123 }));
    await expect(updateHubSpotContact("contact", { email: "test@example.invalid" }, "portal-a")).rejects.toThrow();
  });
  it("blocks PATCH when a newer user edit appears during the final preflight", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ results: [{ name: "email" }] }))
      .mockResolvedValueOnce(Response.json({ id: "contact", updatedAt: "2026-11-03T10:00:01Z", properties: {} }));
    await expect(updateHubSpotContact("contact", { email: "test@example.invalid" }, "portal-a", "2026-11-03T10:00:00Z")).rejects.toMatchObject({ status: 409 });
    expect(fetchMock.mock.calls.every(([, init]) => init?.method !== "PATCH")).toBe(true);
  });
});
