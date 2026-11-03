import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminSessionValue, isAuthorizedAdmin } from "../src/lib/security/admin-auth";

describe("admin authorization", () => {
  beforeEach(() => { vi.stubEnv("SESSION_SECRET", "s".repeat(32)); vi.stubEnv("APP_BASE_URL", "https://sync.example.invalid"); vi.stubEnv("ADMIN_API_KEY", "operator-key"); });
  afterEach(() => vi.unstubAllEnvs());
  function request(method: string, origin?: string) {
    const headers = new Headers({ cookie: `wixhub_admin_session=${createAdminSessionValue()}` });
    if (origin) headers.set("origin", origin);
    return new Request("https://sync.example.invalid/api/mappings", { method, headers });
  }
  it("permits signed sessions and rejects cross-site or originless cookie mutations", () => {
    expect(isAuthorizedAdmin(request("GET"))).toBe(true);
    expect(isAuthorizedAdmin(request("POST", "https://sync.example.invalid"))).toBe(true);
    expect(isAuthorizedAdmin(request("POST", "https://attacker.invalid"))).toBe(false);
    expect(isAuthorizedAdmin(request("POST"))).toBe(false);
  });
  it("permits server-to-server bearer credentials and rejects altered/expired sessions", () => {
    expect(isAuthorizedAdmin(new Request("https://sync.example.invalid", { method: "POST", headers: { authorization: "Bearer operator-key" } }))).toBe(true);
    const expired = createAdminSessionValue(Math.floor(Date.now() / 1000) - 13 * 3600);
    expect(isAuthorizedAdmin(new Request("https://sync.example.invalid", { headers: { cookie: `wixhub_admin_session=${expired}` } }))).toBe(false);
    expect(isAuthorizedAdmin(new Request("https://sync.example.invalid", { headers: { cookie: "wixhub_admin_session=%ZZ" } }))).toBe(false);
  });
});
