import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyWixCustomerProof } from "../src/lib/providers/wix/customer-proof";
const app = "10000000-0000-4000-8000-000000000001", site = "10000000-0000-4000-8000-000000000002", owner = "10000000-0000-4000-8000-000000000003";
const now = Date.parse("2026-11-03T12:00:00Z");
function proof(overrides: Record<string, unknown> = {}) {
  return `${Buffer.alloc(32, 1).toString("base64url")}.${Buffer.from(JSON.stringify({ instanceId: site, uid: owner, siteOwnerId: owner, permissions: "OWNER", signDate: new Date(now).toISOString(), ...overrides })).toString("base64url")}`;
}
const valid = { active: true, clientId: app, instanceId: site };
beforeEach(() => { vi.stubEnv("WIX_APP_ID", app); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("Wix customer ownership proof verification contract", () => {
  it("requires configuration and rejects malformed canonical envelopes before provider requests", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    vi.stubEnv("WIX_APP_ID", ""); await expect(verifyWixCustomerProof(proof(), now)).rejects.toMatchObject({ status: 503 }); vi.stubEnv("WIX_APP_ID", app);
    for (const value of ["bad", "a.b", "!.e30", `${Buffer.alloc(32,1).toString("base64url")}.eA`, "x".repeat(17000), proof({ signDate: new Date(now+61000).toISOString() })]) await expect(verifyWixCustomerProof(value,now)).rejects.toMatchObject({ status: 403 });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("requires active matching app and installation plus valid provider time claims", async () => {
    for (const body of [{}, { ...valid, active: false }, { ...valid, active: "false" }, { ...valid, clientId: "other" }, { ...valid, instanceId: "other" }, { ...valid, exp: now/1000 }, { ...valid, iat: now/1000+61 }, { ...valid, exp: "bad" }]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(body)));
      await expect(verifyWixCustomerProof(proof(), now)).rejects.toMatchObject({ status: 403 });
    }
  });
  it("accepts documented numeric or string time claims after HTTPS token introspection", async () => {
    for (const body of [valid, { ...valid, active: "true", exp: String(now/1000+600), iat: now/1000 }]) {
      const fetcher = vi.fn().mockResolvedValue(Response.json(body)); vi.stubGlobal("fetch", fetcher);
      await expect(verifyWixCustomerProof(proof(), now)).resolves.toEqual({ instanceId: site });
      expect(fetcher).toHaveBeenCalledWith("https://www.wixapis.com/oauth2/token-info", expect.objectContaining({ method: "POST", body: JSON.stringify({ token: proof() }), cache: "no-store" }));
    }
  });
  it("distinguishes rejected proofs from retryable provider failures", async () => {
    for (const status of [400,401,403,429,503]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status, headers: { "retry-after": "60" } })));
      await expect(verifyWixCustomerProof(proof(), now)).rejects.toMatchObject(status < 429 ? { status: 403 } : { status });
    }
  });
});
