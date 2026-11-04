import { afterEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("../src/lib/supabase/admin", () => ({ getSupabaseAdmin: () => ({ from: m.from }) }));
import { requireOwnedAccount, requireOwnedPair } from "../src/lib/security/customer-resources";
import { requireOwnedConnection, tenantContextForVerifiedUser, type TenantContext } from "../src/lib/security/customer-auth";
import { customerFailure, readCustomerJson } from "../src/lib/security/customer-response";
import { customerRedirectUri } from "../src/lib/providers/hubspot/customer-oauth";
const id = "00000000-0000-4000-8000-000000000001";
const context: TenantContext = { userId: id, tenantId: id, role: "owner" };
function database(results: Array<{ data: unknown; error: unknown }>) {
  m.from.mockImplementation(() => {
    const result = results.shift();
    const q = { select: () => q, eq: () => q, is: () => q, limit: () => Promise.resolve(result), maybeSingle: () => Promise.resolve(result) };
    return q;
  });
}
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });
describe("customer access fails closed during outages and ambiguity", () => {
  it("does not authorize membership or resources when database validation fails", async () => {
    database([{ data: null, error: new Error("synthetic storage outage") }]);
    await expect(tenantContextForVerifiedUser(id,id)).rejects.toMatchObject({ status: 503 });
    database([{ data: { role: "owner" }, error: null }, { data: null, error: new Error("outage") }]);
    await expect(tenantContextForVerifiedUser(id,id)).rejects.toMatchObject({ status: 503 });
    for (const lookup of [() => requireOwnedAccount(context,"wix","site"), () => requireOwnedConnection(context,id)]) {
      database([{ data: null, error: new Error("outage") }]); await expect(lookup()).rejects.toMatchObject({ status: 503 });
    }
  });
  it("rejects missing accounts and missing or ambiguous pairs without selecting a destination", async () => {
    for (const account of ["", " ", "x".repeat(513)]) await expect(requireOwnedAccount(context,"wix",account)).rejects.toMatchObject({ status: 400 });
    database([{ data: null, error: null }]); await expect(requireOwnedAccount(context,"wix","site")).rejects.toMatchObject({ status: 403 });
    for (const [pairs, pairId, status] of [[[], undefined, 409], [[{},{}], undefined,409], [[],id,403]] as const) {
      database([{ data: { id }, error: null }, { data: pairs, error: null }]);
      await expect(requireOwnedPair(context,id,pairId)).rejects.toMatchObject({ status });
    }
    database([{ data: { id }, error: null }, { data: null, error: new Error("outage") }]);
    await expect(requireOwnedPair(context,id)).rejects.toMatchObject({ status: 503 });
  });
  it("bounds input and returns generic outage responses without sensitive error details", async () => {
    await expect(readCustomerJson(new Request("https://example.invalid", { method: "POST", body: "x".repeat(32769) }))).rejects.toMatchObject({ status: 413 });
    try { await readCustomerJson(new Request("https://example.invalid", { method: "POST", body: "x".repeat(32769) })); }
    catch (error) { expect(customerFailure(error,"test").status).toBe(413); }
    const log = vi.spyOn(console,"error").mockImplementation(() => {});
    const response = customerFailure(new Error("sensitive-token-and-contact"),"test");
    expect(response.status).toBe(503); expect(await response.text()).not.toContain("sensitive-token"); expect(JSON.stringify(log.mock.calls)).not.toContain("sensitive-token"); log.mockRestore();
  });
  it("prevents redirect origin, path, query, fragment and production downgrade misconfiguration", () => {
    vi.stubEnv("APP_BASE_URL","https://sync.example.invalid");
    for (const uri of ["https://other.invalid/api/customer/oauth/hubspot/callback", "https://sync.example.invalid/other", "https://sync.example.invalid/api/customer/oauth/hubspot/callback?x=y", "https://sync.example.invalid/api/customer/oauth/hubspot/callback#x"]) {
      vi.stubEnv("HUBSPOT_CUSTOMER_REDIRECT_URI",uri); expect(() => customerRedirectUri()).toThrow();
    }
    vi.stubEnv("HUBSPOT_CUSTOMER_REDIRECT_URI",""); expect(customerRedirectUri()).toBe("https://sync.example.invalid/api/customer/oauth/hubspot/callback");
    vi.stubEnv("NODE_ENV","production"); vi.stubEnv("APP_BASE_URL","http://localhost:3000"); expect(() => customerRedirectUri()).toThrow();
  });
});
