import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ admin: vi.fn() }));
vi.mock("../src/lib/supabase/admin", () => ({ getSupabaseAdmin: m.admin }));
import { createContactWithIntent, type CreationIntent } from "../src/lib/sync/creation-intent";
import { ProviderApiError, ProviderPreflightError } from "../src/lib/providers/api-error";

describe("durable contact creation boundary", () => {
  const intent: CreationIntent = { id: "intent", state: "reserved", lookupEmail: "initial@example.invalid", destinationId: null };
  const update = vi.fn(); const eq = vi.fn(); const rpc = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    const query = { update: update.mockReturnThis(), eq: eq.mockReturnThis(), select: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { id: "intent" }, error: null }) };
    rpc.mockResolvedValue({ data: null, error: null });
    m.admin.mockReturnValue({ from: vi.fn().mockReturnValue(query), rpc });
  });
  it("marks the creation boundary before invoking the provider and remembers its identity", async () => {
    const create = vi.fn().mockResolvedValue({ id: "remote" });
    expect(await createContactWithIntent(intent, create)).toEqual({ id: "remote" });
    expect(update.mock.invocationCallOrder[0]).toBeLessThan(create.mock.invocationCallOrder[0]);
    expect(eq).toHaveBeenCalledWith("state", "reserved");
    expect(rpc).toHaveBeenCalledWith("remember_contact_creation", { p_intent_id: "intent", p_destination_id: "remote" });
  });
  it("never repeats an uncertain remote create even when reconciliation finds no contact", async () => {
    const create = vi.fn();
    await expect(createContactWithIntent({ ...intent, state: "creating" }, create)).rejects.toThrow(/reconciliation/);
    expect(create).not.toHaveBeenCalled(); expect(m.admin).not.toHaveBeenCalled();
  });
  it("leaves a timeout uncertain and refunds a definitively rejected rate-limited write", async () => {
    await expect(createContactWithIntent(intent, async () => { throw new Error("network timeout"); })).rejects.toThrow(/timeout/);
    expect(update).toHaveBeenCalledTimes(1);
    vi.clearAllMocks();
    await expect(createContactWithIntent(intent, async () => { throw new ProviderApiError("hubspot", 429, "120"); })).rejects.toMatchObject({ status: 429 });
    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ state: "reserved", attempt_id: null }));
    expect(eq).toHaveBeenCalledWith("attempt_id", expect.any(String));
  });
  it("does not reset the intent when provider success is followed by database failure", async () => {
    rpc.mockResolvedValue({ error: { message: "database unavailable" } });
    const create = vi.fn().mockResolvedValue({ id: "remote" });
    await expect(createContactWithIntent(intent, create)).rejects.toThrow(/remember/);
    expect(create).toHaveBeenCalledTimes(1); expect(update).toHaveBeenCalledTimes(1);
  });
  it("retries a preflight failure because no provider write was attempted", async () => {
    await expect(createContactWithIntent(intent, async () => { throw new ProviderPreflightError(new Error("metadata timeout")); })).rejects.toThrow(/metadata timeout/);
    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ state: "reserved" }));
  });
});
