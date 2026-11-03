import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ admin: vi.fn(), consume: vi.fn(), exchange: vi.fn() }));
vi.mock("../src/lib/security/admin-auth", () => ({ isAuthorizedAdmin: m.admin }));
vi.mock("../src/lib/providers/hubspot/oauth", () => ({ consumeOAuthState: m.consume, exchangeHubSpotCode: m.exchange, safeCompareState: (a: string, b: string) => a === b }));
import { GET } from "../src/app/api/oauth/hubspot/callback/route";

describe("OAuth callback authorization and state consumption", () => {
  beforeEach(() => { vi.resetAllMocks(); m.admin.mockReturnValue(true); m.consume.mockResolvedValue(true); m.exchange.mockResolvedValue(undefined); });
  function request(state = "random-state") {
    return new NextRequest(`https://sync.example.invalid/api/oauth/hubspot/callback?code=code&state=${state}`, { headers: { cookie: "hubspot_oauth_state=random-state" } });
  }
  it("requires operator authorization", async () => {
    m.admin.mockReturnValue(false);
    expect((await GET(request())).status).toBe(401);
    expect(m.exchange).not.toHaveBeenCalled();
  });
  it("rejects mismatched or previously consumed state before exchanging credentials", async () => {
    expect((await GET(request("wrong-state"))).status).toBe(400);
    m.consume.mockResolvedValue(false);
    expect((await GET(request())).status).toBe(400);
    expect(m.exchange).not.toHaveBeenCalled();
  });
  it("consumes state before code exchange and clears the correct cookie path", async () => {
    const response = await GET(request());
    expect(response.status).toBe(307);
    expect(m.consume.mock.invocationCallOrder[0]).toBeLessThan(m.exchange.mock.invocationCallOrder[0]);
    expect(response.headers.get("set-cookie")).toContain("Path=/api/oauth/hubspot");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
