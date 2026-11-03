import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminSessionValue, isAuthorizedAdmin, verifyDashboardPassword, adminSessionCookieName, adminSessionMaxAge } from "../src/lib/security/admin-auth";

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
  it.each(["", "123", ".signature", "123.", "not-time.signature", "123.signature.extra", "999999999999999999999.signature"])("rejects malformed session: %s", (value) => {
    expect(isAuthorizedAdmin(new Request("https://sync.example.invalid", { headers: { cookie: `wixhub_admin_session=${value}` } }))).toBe(false);
  });
  it("rejects forged and future sessions, missing cookies and wrong API credentials", () => {
    const forged = `${Math.floor(Date.now() / 1000)}.${"x".repeat(43)}`;
    const future = createAdminSessionValue(Math.floor(Date.now() / 1000) + 120);
    for (const cookie of [forged, future]) expect(isAuthorizedAdmin(new Request("https://sync.example.invalid", { headers: { cookie: `other=value; wixhub_admin_session=${cookie}` } }))).toBe(false);
    expect(isAuthorizedAdmin(new Request("https://sync.example.invalid"))).toBe(false);
    expect(isAuthorizedAdmin(new Request("https://sync.example.invalid", { headers: { authorization: "Bearer wrong-key" } }))).toBe(false);
  });
  it("fails closed when the session signing key is unavailable or too short", () => {
    const valid = request("GET"); vi.stubEnv("SESSION_SECRET", "");
    expect(() => createAdminSessionValue()).toThrow(/SESSION_SECRET/);
    expect(isAuthorizedAdmin(valid)).toBe(false);
    vi.stubEnv("SESSION_SECRET", "short"); expect(isAuthorizedAdmin(valid)).toBe(false);
  });
  it("requires a configured matching dashboard password and preserves the session lifetime contract", () => {
    vi.stubEnv("DASHBOARD_PASSWORD", ""); expect(verifyDashboardPassword("anything")).toBe(false);
    vi.stubEnv("DASHBOARD_PASSWORD", "synthetic-password");
    expect(verifyDashboardPassword("wrong")).toBe(false); expect(verifyDashboardPassword("synthetic-password")).toBe(true);
    expect(adminSessionCookieName()).toBe("wixhub_admin_session"); expect(adminSessionMaxAge()).toBe(12 * 60 * 60);
  });
});
