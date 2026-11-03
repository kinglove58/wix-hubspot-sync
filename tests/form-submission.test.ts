import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ resolve: vi.fn(), admin: vi.fn(), find: vi.fn(), create: vi.fn(), update: vi.fn(), ensure: vi.fn(), wix: vi.fn(), prepare: vi.fn(), remember: vi.fn() }));
vi.mock("../src/lib/providers/hubspot/client", () => ({ findHubSpotContactByEmail: m.find, createHubSpotContact: m.create, updateHubSpotContact: m.update, ensureHubSpotFormAttributionProperties: m.ensure, getHubSpotContact: vi.fn() }));
vi.mock("../src/lib/providers/wix/contacts", () => ({ getWixContact: m.wix }));
vi.mock("../src/lib/sync/connection-repository", () => ({ resolveProviderConnections: m.resolve }));
vi.mock("../src/lib/supabase/admin", () => ({ getSupabaseAdmin: m.admin }));
vi.mock("../src/lib/sync/lease", () => ({ withIntegrationLease: (_key: string, run: () => Promise<unknown>) => run() }));
vi.mock("../src/lib/sync/creation-intent", () => ({ prepareContactCreation: m.prepare, rememberContactCreation: m.remember, createContactWithIntent: (_intent: unknown, create: () => Promise<unknown>) => create() }));
import { syncWixFormSubmissionToHubSpot } from "../src/lib/sync/form-submission";

describe("documented Wix form submissions", () => {
  let linked = false;
  beforeEach(() => {
    vi.resetAllMocks(); linked = false;
    m.resolve.mockResolvedValue({ wix: { id: "wix-connection" }, hubspot: { id: "hubspot-connection" } });
    m.find.mockResolvedValue(null); m.create.mockResolvedValue({ id: "new-contact" }); m.update.mockResolvedValue({ id: "stable-contact" });
    m.wix.mockResolvedValue({ id: "wix-contact" });
    m.prepare.mockImplementation(async (input: { email: string }) => ({ id: "intent", state: "reserved", lookupEmail: input.email, destinationId: null }));
    const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn(async () => ({ data: linked ? { hubspot_contact_id: "stable-contact", wix_contact_id: "wix-contact" } : null, error: null })), insert: vi.fn().mockResolvedValue({ error: null }), upsert: vi.fn().mockResolvedValue({ error: null }) };
    m.admin.mockReturnValue({ from: vi.fn().mockReturnValue(query) });
  });
  it("extracts the current createdEvent.entity.submissions map and scopes all writes", async () => {
    await syncWixFormSubmissionToHubSpot("site", { entityId: "submission", createdEvent: { entity: { id: "submission", submissions: { email: "test@example.invalid", firstName: "Ada" } } } });
    expect(m.create).toHaveBeenCalledWith(expect.objectContaining({ email: "test@example.invalid", firstname: "Ada" }), "hubspot-connection");
    expect(m.prepare).toHaveBeenCalledWith(expect.objectContaining({ sourceId: "form:submission", wixConnectionId: "wix-connection", hubspotConnectionId: "hubspot-connection" }));
  });
  it("uses the linked contact identity when a new submission changes its email", async () => {
    linked = true;
    await syncWixFormSubmissionToHubSpot("site", { entityId: "submission", createdEvent: { entity: { id: "submission", contactId: "wix-contact", submissions: { email: "changed@example.invalid" } } } });
    expect(m.update).toHaveBeenCalledWith("stable-contact", expect.objectContaining({ email: "changed@example.invalid" }), "hubspot-connection");
    expect(m.find).not.toHaveBeenCalled(); expect(m.create).not.toHaveBeenCalled();
  });
  it("requires a stable identity before creating a form contact", async () => {
    await expect(syncWixFormSubmissionToHubSpot("site", { fields: { email: "test@example.invalid" } })).rejects.toThrow(/stable/);
    expect(m.create).not.toHaveBeenCalled();
  });
});
