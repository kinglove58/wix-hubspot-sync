import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  getWix: vi.fn(), findWix: vi.fn(), createWix: vi.fn(), updateWix: vi.fn(),
  getHubSpot: vi.fn(), findHubSpot: vi.fn(), createHubSpot: vi.fn(), updateHubSpot: vi.fn(),
  mappings: vi.fn(), admin: vi.fn(), resolve: vi.fn(),
}));
vi.mock("../src/lib/providers/wix/contacts", () => ({ getWixContact: m.getWix, findWixContactByEmail: m.findWix, createWixContact: m.createWix, updateWixContact: m.updateWix }));
vi.mock("../src/lib/providers/hubspot/client", () => ({ getHubSpotContact: m.getHubSpot, findHubSpotContactByEmail: m.findHubSpot, createHubSpotContact: m.createHubSpot, updateHubSpotContact: m.updateHubSpot }));
vi.mock("../src/lib/sync/connection-repository", () => ({ resolveProviderConnections: m.resolve }));
vi.mock("../src/lib/sync/mapping-repository", () => ({ listEnabledMappings: m.mappings }));
vi.mock("../src/lib/supabase/admin", () => ({ getSupabaseAdmin: m.admin }));
vi.mock("../src/lib/sync/lease", () => ({ withIntegrationLease: (_key: string, run: () => Promise<unknown>) => run() }));
vi.mock("../src/lib/sync/creation-intent", () => ({
  prepareContactCreation: vi.fn(async (input: { email: string }) => ({ id: "intent", state: "reserved", lookupEmail: input.email, destinationId: null })),
  rememberContactCreation: vi.fn(async () => undefined),
  createContactWithIntent: (_intent: unknown, create: () => Promise<unknown>) => create(),
}));
import { syncHubSpotContactToWix, syncWixContactToHubSpot } from "../src/lib/sync/engine";

describe("contact synchronization", () => {
  let reads: unknown[];
  const upsert = vi.fn();
  const insert = vi.fn();
  beforeEach(() => {
    vi.resetAllMocks(); reads = [];
    m.resolve.mockResolvedValue({ wix: { id: "wix-connection" }, hubspot: { id: "portal-connection" } });
    m.mappings.mockResolvedValue([]);
    m.getWix.mockResolvedValue({ id: "wix-contact", revision: 7, updatedDate: "2026-11-01T10:00:00Z", info: { name: { first: "Ada" }, emails: { items: [{ email: "ada@example.invalid" }] } } });
    m.getHubSpot.mockResolvedValue({ id: "hubspot-contact", updatedAt: "2026-11-01T09:00:00Z", properties: { email: "ada@example.invalid", firstname: "Ada" } });
    m.findHubSpot.mockResolvedValue(null); m.findWix.mockResolvedValue(undefined);
    m.createHubSpot.mockResolvedValue({ id: "hubspot-contact", updatedAt: "2026-11-01T10:00:01Z" });
    m.updateHubSpot.mockResolvedValue({ id: "hubspot-contact", updatedAt: "2026-11-01T10:00:01Z" });
    m.createWix.mockResolvedValue({ id: "wix-contact", revision: 1 });
    upsert.mockResolvedValue({ error: null }); insert.mockResolvedValue({ error: null });
    const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn(async () => { const value = reads.shift(); return value instanceof Error ? { data: null, error: value } : { data: value ?? null, error: null }; }), upsert, insert };
    m.admin.mockReturnValue({ from: vi.fn().mockReturnValue(query) });
  });

  it("creates with the paired portal and stores stable identity plus audit scope", async () => {
    expect((await syncWixContactToHubSpot("site", "wix-contact")).status).toBe("succeeded");
    expect(m.createHubSpot).toHaveBeenCalledWith({ firstname: "Ada", email: "ada@example.invalid" }, "portal-connection");
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ wix_connection_id: "wix-connection", hubspot_connection_id: "portal-connection", wix_contact_id: "wix-contact", hubspot_contact_id: "hubspot-contact" }), expect.any(Object));
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ wix_connection_id: "wix-connection", hubspot_connection_id: "portal-connection" }));
  });

  it("updates the permanent contact ID after an email change without email matching", async () => {
    reads = [{ hubspot_contact_id: "stable-id" }, null];
    await syncWixContactToHubSpot("site", "wix-contact");
    expect(m.findHubSpot).not.toHaveBeenCalled();
    expect(m.createHubSpot).not.toHaveBeenCalled();
    expect(m.updateHubSpot).toHaveBeenCalledWith("stable-id", expect.any(Object), "portal-connection", expect.any(String));
  });

  it("creates a named Wix contact without an email using its stable source identity", async () => {
    m.getWix.mockResolvedValue({ id: "wix-contact", info: { name: { first: "Ada" } } });
    expect((await syncWixContactToHubSpot("site", "wix-contact")).status).toBe("succeeded");
    expect(m.createHubSpot).toHaveBeenCalledWith({ firstname: "Ada" }, "portal-connection");
    expect(m.findHubSpot).not.toHaveBeenCalled();
  });

  it("creates a named HubSpot contact without an email using its stable source identity", async () => {
    m.getHubSpot.mockResolvedValue({ id: "hubspot-contact", properties: { firstname: "Ada" } });
    expect((await syncHubSpotContactToWix("site", "hubspot-contact", { properties: { firstname: "Ada" } })).status).toBe("succeeded");
    expect(m.createWix).toHaveBeenCalledWith("site", { name: { first: "Ada" } });
    expect(m.findWix).not.toHaveBeenCalled();
  });

  it("does not overwrite a contact already linked to a different source", async () => {
    reads = [null, { wix_contact_id: "other-source" }];
    m.findHubSpot.mockResolvedValue({ id: "already-linked" });
    expect(await syncWixContactToHubSpot("site", "wix-contact")).toEqual({ status: "skipped", reason: "hubspot_contact_already_linked" });
    expect(m.updateHubSpot).not.toHaveBeenCalled(); expect(m.createHubSpot).not.toHaveBeenCalled(); expect(upsert).not.toHaveBeenCalled();
  });

  it("protects newer live destination edits even when cached link timestamps are older", async () => {
    reads = [{ hubspot_contact_id: "linked", hubspot_updated_at: "2026-11-01T08:00:00Z" }];
    m.getHubSpot.mockResolvedValue({ id: "linked", updatedAt: "2026-11-01T11:00:00Z" });
    expect((await syncWixContactToHubSpot("site", "wix-contact")).status).toBe("skipped");
    expect(m.updateHubSpot).not.toHaveBeenCalled();
  });

  it("protects a newer unlinked email match before the first synchronization", async () => {
    reads = [null, null];
    m.findHubSpot.mockResolvedValue({ id: "match", updatedAt: "2026-11-01T11:00:00Z" });
    expect((await syncWixContactToHubSpot("site", "wix-contact")).status).toBe("skipped");
    expect(m.updateHubSpot).not.toHaveBeenCalled(); expect(m.createHubSpot).not.toHaveBeenCalled();
  });

  it("passes reverse custom mapping as contact info, without a second info wrapper", async () => {
    m.mappings.mockResolvedValue([{ id: "map", sourceField: "info.name.first", targetField: "firstname", direction: "both", transform: "trim", enabled: true }]);
    await syncHubSpotContactToWix("site", "hubspot-contact", { properties: { email: "ada@example.invalid", firstname: " Ada " } });
    expect(m.createWix).toHaveBeenCalledWith("site", { name: { first: "Ada" }, emails: { items: [{ email: "ada@example.invalid", primary: true }] } });
  });

  it("protects reverse email matches before updating Wix", async () => {
    reads = [null, { hubspot_contact_id: "someone-else" }];
    m.findWix.mockResolvedValue({ id: "linked", revision: 3 });
    expect((await syncHubSpotContactToWix("site", "hubspot-contact", { properties: { email: "ada@example.invalid" } })).status).toBe("skipped");
    expect(m.updateWix).not.toHaveBeenCalled(); expect(m.createWix).not.toHaveBeenCalled();
  });

  it("does not replace an intentionally disabled mapping set with default fields", async () => {
    m.mappings.mockResolvedValue([{ id: "map", sourceField: "info.name.first", targetField: "firstname", direction: "both", transform: "none", enabled: false }]);
    expect((await syncWixContactToHubSpot("site", "wix-contact")).status).toBe("skipped");
    expect(m.createHubSpot).not.toHaveBeenCalled();
  });

  it("does not restore default fields after explicitly saving an empty configuration", async () => {
    m.resolve.mockResolvedValue({ wix: { id: "wix-connection" }, hubspot: { id: "portal-connection" }, useDefaultMappings: false });
    expect((await syncWixContactToHubSpot("site", "wix-contact")).status).toBe("skipped");
    expect(m.createHubSpot).not.toHaveBeenCalled(); expect(m.updateHubSpot).not.toHaveBeenCalled();
  });

  it("uses the live reverse source inside the lease and preserves existing Wix collection entries", async () => {
    reads = [{ wix_contact_id: "wix-contact" }, null];
    m.getWix.mockResolvedValue({ id: "wix-contact", revision: 9, updatedDate: "2026-11-01T08:00:00Z", info: { name: { last: "Lovelace" } } });
    m.updateWix.mockResolvedValue({ id: "wix-contact", updatedDate: "2026-11-01T10:00:01Z" });
    await syncHubSpotContactToWix("site", "hubspot-contact", { properties: { firstname: "stale" } });
    expect(m.updateWix).toHaveBeenCalledWith("site", "wix-contact", 9, expect.objectContaining({ name: { first: "Ada", last: "Lovelace" } }));
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ wix_updated_at: "2026-11-01T10:00:01Z", last_source: "hubspot" }), expect.any(Object));
  });

  it("rejects newer Wix user edits for linked and initially matched reverse contacts", async () => {
    reads = [{ wix_contact_id: "wix-contact" }];
    expect(await syncHubSpotContactToWix("site", "hubspot-contact", {})).toMatchObject({ status: "skipped", reason: "wix_version_is_newer" });
    expect(m.updateWix).not.toHaveBeenCalled();
    reads = [null, null];
    m.findWix.mockResolvedValue({ id: "wix-contact", revision: 7, updatedDate: "2026-11-01T10:00:00Z" });
    expect(await syncHubSpotContactToWix("site", "hubspot-contact", {})).toMatchObject({ status: "skipped", reason: "wix_version_is_newer" });
    expect(m.createWix).not.toHaveBeenCalled(); expect(m.updateWix).not.toHaveBeenCalled();
  });

  it.each([true, false])("requires a revision before reverse updates (linked=%s)", async (linked) => {
    reads = linked ? [{ wix_contact_id: "wix-contact" }] : [null, null];
    const snapshot = { id: "wix-contact", updatedDate: "2026-11-01T08:00:00Z" };
    m.getWix.mockResolvedValue(snapshot); m.findWix.mockResolvedValue(snapshot);
    await expect(syncHubSpotContactToWix("site", "hubspot-contact", {})).rejects.toThrow(/revision/);
    expect(m.updateWix).not.toHaveBeenCalled();
  });

  it("updates an older reverse email match and remembers its stable identity", async () => {
    reads = [null, null, null];
    m.findWix.mockResolvedValue({ id: "wix-contact", revision: 3, updatedDate: "2026-11-01T08:00:00Z" });
    m.updateWix.mockResolvedValue({ id: "wix-contact" });
    expect(await syncHubSpotContactToWix("site", "hubspot-contact", {})).toMatchObject({ status: "succeeded" });
    expect(m.createWix).not.toHaveBeenCalled(); expect(m.updateWix).toHaveBeenCalledWith("site", "wix-contact", 3, expect.any(Object));
  });

  it("updates an older forward email match instead of creating a duplicate", async () => {
    reads = [null, null, null];
    m.findHubSpot.mockResolvedValue({ id: "match", updatedAt: "2026-11-01T08:00:00Z" });
    expect(await syncWixContactToHubSpot("site", "wix-contact")).toMatchObject({ status: "succeeded" });
    expect(m.updateHubSpot).toHaveBeenCalledWith("match", expect.any(Object), "portal-connection", "2026-11-01T08:00:00Z");
    expect(m.createHubSpot).not.toHaveBeenCalled();
  });

  it.each(["wix", "hubspot"])("blocks writes if %s contact-link lookup fails", async (provider) => {
    reads = [new Error("database unavailable")];
    const run = provider === "wix" ? syncWixContactToHubSpot("site", "wix-contact") : syncHubSpotContactToWix("site", "hubspot-contact", {});
    await expect(run).rejects.toThrow(/read contact link/);
    expect(m.createWix).not.toHaveBeenCalled(); expect(m.createHubSpot).not.toHaveBeenCalled(); expect(m.updateWix).not.toHaveBeenCalled(); expect(m.updateHubSpot).not.toHaveBeenCalled();
  });

  it.each(["wix", "hubspot"])("does not report success if %s link persistence fails after provider success", async (provider) => {
    upsert.mockResolvedValue({ error: new Error("database unavailable") });
    const run = provider === "wix" ? syncWixContactToHubSpot("site", "wix-contact") : syncHubSpotContactToWix("site", "hubspot-contact", {});
    await expect(run).rejects.toThrow(/save contact link/);
    expect(insert).not.toHaveBeenCalledWith(expect.objectContaining({ outcome: "succeeded" }));
  });

  it.each(["wix", "hubspot"])("rejects a %s create response without a stable destination ID", async (provider) => {
    m.createWix.mockResolvedValue({}); m.createHubSpot.mockResolvedValue({});
    const run = provider === "wix" ? syncWixContactToHubSpot("site", "wix-contact") : syncHubSpotContactToWix("site", "hubspot-contact", {});
    await expect(run).rejects.toThrow(/contact ID/); expect(upsert).not.toHaveBeenCalled();
  });

  it.each(["wix", "hubspot"])("fails closed if the matched %s identity cannot be checked", async (provider) => {
    reads = [null, new Error("database unavailable")];
    m.findHubSpot.mockResolvedValue({ id: "match" }); m.findWix.mockResolvedValue({ id: "match", revision: 1 });
    await expect(provider === "wix" ? syncWixContactToHubSpot("site", "wix-contact") : syncHubSpotContactToWix("site", "hubspot-contact", {})).rejects.toThrow(/matched contact identity/);
    expect(m.updateWix).not.toHaveBeenCalled(); expect(m.updateHubSpot).not.toHaveBeenCalled();
  });

  it.each(["wix", "hubspot"])("does not continue if establishing a matched %s identity fails", async (provider) => {
    reads = [null, null]; insert.mockResolvedValue({ error: new Error("database unavailable") });
    m.findHubSpot.mockResolvedValue({ id: "match" }); m.findWix.mockResolvedValue({ id: "match", revision: 1 });
    await expect(provider === "wix" ? syncWixContactToHubSpot("site", "wix-contact") : syncHubSpotContactToWix("site", "hubspot-contact", {})).rejects.toThrow(/establish matched/);
    expect(m.updateWix).not.toHaveBeenCalled(); expect(m.updateHubSpot).not.toHaveBeenCalled();
  });

  it.each(["wix", "hubspot"])("retains a failed outcome when final %s identity verification is unavailable", async (provider) => {
    reads = [null, new Error("database unavailable")];
    await expect(provider === "wix" ? syncWixContactToHubSpot("site", "wix-contact") : syncHubSpotContactToWix("site", "hubspot-contact", {})).rejects.toThrow(/verify contact identity link/);
    expect(upsert).not.toHaveBeenCalled();
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ outcome: "failed", wix_connection_id: "wix-connection", hubspot_connection_id: "portal-connection" }));
  });

  it.each(["wix", "hubspot"])("never replaces another link after a conflicting %s write response", async (provider) => {
    reads = [null, provider === "wix" ? { wix_contact_id: "other" } : { hubspot_contact_id: "other" }];
    const result = await (provider === "wix" ? syncWixContactToHubSpot("site", "wix-contact") : syncHubSpotContactToWix("site", "hubspot-contact", {}));
    expect(result).toMatchObject({ status: "skipped", reason: provider === "wix" ? "hubspot_contact_already_linked" : "wix_contact_already_linked" });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("respects an explicitly empty reverse mapping configuration", async () => {
    m.resolve.mockResolvedValue({ wix: { id: "wix-connection" }, hubspot: { id: "portal-connection" }, useDefaultMappings: false });
    expect(await syncHubSpotContactToWix("site", "hubspot-contact", {})).toMatchObject({ status: "skipped", reason: "no_enabled_mapping_for_direction" });
    expect(m.createWix).not.toHaveBeenCalled(); expect(m.updateWix).not.toHaveBeenCalled();
  });

  it.each(["wix", "hubspot"])("uses deterministic fallback for missing %s source timestamps", async (provider) => {
    m.getWix.mockResolvedValue({ id: "wix-contact", revision: 0, info: { name: { first: "Ada" } } });
    m.getHubSpot.mockResolvedValue({ id: "hubspot-contact", properties: { firstname: "Ada" } });
    reads = [provider === "wix" ? { hubspot_contact_id: "hubspot-contact" } : { wix_contact_id: "wix-contact" }, null];
    m.updateWix.mockResolvedValue({ id: "wix-contact" });
    const result = await (provider === "wix" ? syncWixContactToHubSpot("site", "wix-contact") : syncHubSpotContactToWix("site", "hubspot-contact", {}));
    expect(result.status).toBe(provider === "wix" ? "skipped" : "succeeded");
  });
});
