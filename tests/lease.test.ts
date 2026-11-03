import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ admin: vi.fn() }));
vi.mock("../src/lib/supabase/admin", () => ({ getSupabaseAdmin: m.admin }));
import { withIntegrationLease, withIntegrationWorkBudget, assertIntegrationLease, integrationWorkSignal } from "../src/lib/sync/lease";

describe("integration lease ownership and deadlines", () => {
  const rpc = vi.fn(); const maybeSingle = vi.fn(); const eq = vi.fn(); const release = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks(); rpc.mockResolvedValue({ data: true, error: null }); maybeSingle.mockResolvedValue({ data: { owner: "owned" }, error: null });
    const query = { error: null, select: vi.fn().mockReturnThis(), eq: eq.mockReturnThis(), gt: vi.fn().mockReturnThis(), maybeSingle, delete: release.mockReturnThis() };
    m.admin.mockReturnValue({ rpc, from: vi.fn().mockReturnValue(query) });
  });
  afterEach(() => vi.restoreAllMocks());
  it("checks ownership immediately before a write and releases its own key", async () => {
    await withIntegrationLease("site", async () => { await assertIntegrationLease(); expect(integrationWorkSignal()).toBeInstanceOf(AbortSignal); });
    expect(eq).toHaveBeenCalledWith("lease_key", "site"); expect(eq).toHaveBeenCalledWith("owner", expect.any(String)); expect(release).toHaveBeenCalled();
  });
  it("blocks a resumed worker after lease replacement", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(withIntegrationLease("site", () => assertIntegrationLease())).rejects.toThrow(/lease expired or was replaced/);
  });
  it("blocks work past the processing deadline even before touching the provider", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1000);
    await withIntegrationLease("site", async () => {
      now.mockReturnValue(250_000);
      expect(() => integrationWorkSignal()).toThrow(/lease/);
      await expect(assertIntegrationLease()).rejects.toThrow(/lease/);
    });
  });
  it("does not run another worker's lease and reports database acquisition failures", async () => {
    const work = vi.fn(); rpc.mockResolvedValueOnce({ data: false, error: null });
    await expect(withIntegrationLease("site", work)).rejects.toThrow(/busy/); expect(work).not.toHaveBeenCalled();
    rpc.mockResolvedValueOnce({ data: null, error: { code: "unavailable" } });
    await expect(withIntegrationLease("site", work)).rejects.toThrow(/acquire/);
  });
  it("checks every parent lease for nested site/portal work", async () => {
    await withIntegrationLease("site", () => withIntegrationLease("portal", () => assertIntegrationLease()));
    expect(maybeSingle).toHaveBeenCalledTimes(2);
    await expect(assertIntegrationLease()).resolves.toBeUndefined();
  });
  it("shares the worker deadline across sequential targets instead of resetting it", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1000);
    await withIntegrationWorkBudget(async () => {
      await withIntegrationLease("first", () => assertIntegrationLease());
      now.mockReturnValue(242000);
      await expect(withIntegrationLease("second", () => assertIntegrationLease())).rejects.toThrow(/lease/);
    });
  });
});
