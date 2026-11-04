import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ admin: vi.fn() }));
vi.mock("../src/lib/supabase/admin", () => ({ getSupabaseAdmin: m.admin }));
import { resolveProviderConnections, resolveWixInstanceForPortal } from "../src/lib/sync/connection-repository";

describe("explicit account routing", () => {
  let reads: unknown[];
  const eq = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks(); reads = [];
    const query = { select: vi.fn().mockReturnThis(), eq: eq.mockReturnThis(), is: vi.fn().mockReturnThis(), maybeSingle: vi.fn(async () => ({ data: reads.shift() ?? null, error: null })) };
    m.admin.mockReturnValue({ from: vi.fn().mockReturnValue(query), rpc: vi.fn().mockResolvedValue({ data: false, error: null }) });
  });
  it("follows only the explicitly paired portal", async () => {
    reads = [{ id: "site-a", external_account_id: "instance-a" }, { hubspot_connection_id: "portal-b" }, { id: "portal-b", external_account_id: "200" }];
    expect((await resolveProviderConnections("instance-a")).hubspot.id).toBe("portal-b");
    expect(eq).toHaveBeenCalledWith("id", "portal-b");
  });
  it("refuses unpaired Wix sites rather than selecting another connected portal", async () => {
    reads = [{ id: "site-a", external_account_id: "instance-a" }, null];
    await expect(resolveProviderConnections("instance-a")).rejects.toThrow(/explicit/);
  });
  it("resolves incoming HubSpot events by their portal identity", async () => {
    reads = [{ id: "portal-b" }, { wix_connection_id: "site-b" }, { external_account_id: "instance-b" }];
    expect(await resolveWixInstanceForPortal("200")).toBe("instance-b");
    expect(eq).toHaveBeenCalledWith("external_account_id", "200");
    expect(eq).toHaveBeenCalledWith("id", "site-b");
  });
  it("refuses disconnected or unknown source portals", async () => {
    await expect(resolveWixInstanceForPortal("unknown")).rejects.toThrow(/not connected/);
  });
  it("blocks synchronization while uninstall is pending or its status cannot be verified", async () => {
    for (const result of [{ data: true, error: null }, { data: null, error: new Error("storage unavailable") }, { data: null, error: null }]) {
      reads = [{ id: "site-a", external_account_id: "instance-a" }];
      m.admin().rpc.mockResolvedValueOnce(result);
      await expect(resolveProviderConnections("instance-a")).rejects.toThrow(/lifecycle is unresolved/);
    }
  });
});
