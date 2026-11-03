import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ resolve: vi.fn(), admin: vi.fn(), read: vi.fn(), insert: vi.fn(), upsert: vi.fn(), find: vi.fn(), get: vi.fn(), mappings: vi.fn(), create: vi.fn(), update: vi.fn(), ensure: vi.fn(), wix: vi.fn(), prepare: vi.fn(), remember: vi.fn() }));
vi.mock("../src/lib/providers/hubspot/client", () => ({ findHubSpotContactByEmail: m.find, createHubSpotContact: m.create, updateHubSpotContact: m.update, ensureHubSpotFormAttributionProperties: m.ensure, getHubSpotContact: m.get }));
vi.mock("../src/lib/sync/mapping-repository", () => ({ listEnabledMappings: m.mappings }));
vi.mock("../src/lib/providers/wix/contacts", () => ({ getWixContact: m.wix }));
vi.mock("../src/lib/sync/connection-repository", () => ({ resolveProviderConnections: m.resolve }));
vi.mock("../src/lib/supabase/admin", () => ({ getSupabaseAdmin: m.admin }));
vi.mock("../src/lib/sync/lease", () => ({ withIntegrationLease: (_key: string, run: () => Promise<unknown>) => run() }));
vi.mock("../src/lib/sync/creation-intent", () => ({ prepareContactCreation: m.prepare, rememberContactCreation: m.remember, createContactWithIntent: (_intent: unknown, create: () => Promise<unknown>) => create() }));
import { syncWixFormSubmissionToHubSpot } from "../src/lib/sync/form-submission";
import { ProviderApiError } from "../src/lib/providers/api-error";

describe("documented Wix form submissions", () => {
  let linked = false;
  beforeEach(() => {
    vi.resetAllMocks(); linked = false;
    m.resolve.mockResolvedValue({ wix: { id: "wix-connection" }, hubspot: { id: "hubspot-connection" } });
    m.mappings.mockResolvedValue([]);
    m.get.mockResolvedValue({ id: "stable-contact", updatedAt: "2026-11-01T08:00:00Z" });
    m.find.mockResolvedValue(null); m.create.mockResolvedValue({ id: "new-contact" }); m.update.mockResolvedValue({ id: "stable-contact" });
    m.wix.mockResolvedValue({ id: "wix-contact" });
    m.prepare.mockImplementation(async (input: { email: string }) => ({ id: "intent", state: "reserved", lookupEmail: input.email, destinationId: null }));
    const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: m.read.mockImplementation(async () => ({ data: linked ? { hubspot_contact_id: "stable-contact", wix_contact_id: "wix-contact" } : null, error: null })), insert: m.insert.mockResolvedValue({ error: null }), upsert: m.upsert.mockResolvedValue({ error: null }) };
    m.admin.mockReturnValue({ from: vi.fn().mockReturnValue(query) });
  });
  it("extracts the current createdEvent.entity.submissions map and scopes all writes", async () => {
    await syncWixFormSubmissionToHubSpot("site", { entityId: "submission", createdEvent: { entity: { id: "submission", submissions: { email: "test@example.invalid", firstName: "Ada" } } } });
    expect(m.create).toHaveBeenCalledWith(expect.objectContaining({ email: "test@example.invalid", firstname: "Ada" }), "hubspot-connection");
    expect(m.prepare).toHaveBeenCalledWith(expect.objectContaining({ sourceId: "form:submission", wixConnectionId: "wix-connection", hubspotConnectionId: "hubspot-connection" }));
  });
  it("uses the linked contact identity when a new submission changes its email", async () => {
    linked = true;
    await syncWixFormSubmissionToHubSpot("site", { entityId: "submission", createdEvent: { entity: { id: "submission", createdDate: "2026-11-01T10:00:00Z", contactId: "wix-contact", submissions: { email: "changed@example.invalid" } } } });
    expect(m.update).toHaveBeenCalledWith("stable-contact", expect.objectContaining({ email: "changed@example.invalid", form_submitted_at: "2026-11-01T10:00:00.000Z" }), "hubspot-connection", "2026-11-01T08:00:00Z");
    expect(m.find).not.toHaveBeenCalled(); expect(m.create).not.toHaveBeenCalled();
  });
  it("requires a stable identity before creating a form contact", async () => {
    await expect(syncWixFormSubmissionToHubSpot("site", { fields: { email: "test@example.invalid" } })).rejects.toThrow(/stable/);
    expect(m.create).not.toHaveBeenCalled();
  });
  it.each([undefined, "invalid", "2026-11-01T07:00:00Z", "2026-11-01T08:00:00Z"])("does not overwrite a newer contact from a delayed or undated form (%s)", async (createdDate) => {
    m.find.mockResolvedValue({ id: "stable-contact" });
    expect(await syncWixFormSubmissionToHubSpot("site", { entityId: "submission", submission: { createdDate, submissions: { email: "test@example.invalid", firstName: "old-name" } } })).toMatchObject({ status: "skipped" });
    expect(m.get).toHaveBeenCalledWith("stable-contact", [], "hubspot-connection");
    expect(m.update).not.toHaveBeenCalled(); expect(m.ensure).not.toHaveBeenCalled();
  });
  it("does not fabricate a submission timestamp for new undated contacts", async () => {
    await syncWixFormSubmissionToHubSpot("site", { entityId: "submission", fields: { email: "test@example.invalid" } });
    expect(m.create.mock.calls[0][0]).not.toHaveProperty("form_submitted_at");
  });
  it("applies custom transforms and disabled contact-field masks to form contacts", async () => {
    m.mappings.mockResolvedValue([
      { sourceField: "info.name.first", targetField: "firstname", direction: "both", transform: "none", enabled: false },
      { sourceField: "info.name.last", targetField: "nickname", direction: "wix_to_hubspot", transform: "uppercase", enabled: true },
    ]);
    await syncWixFormSubmissionToHubSpot("site", { entityId: "submission", fields: { email: "test@example.invalid", firstName: "Ada", lastName: "Lovelace" } });
    expect(m.create.mock.calls[0][0]).toMatchObject({ email: "test@example.invalid", lastname: "Lovelace", nickname: "LOVELACE" });
    expect(m.create.mock.calls[0][0]).not.toHaveProperty("firstname");
  });
  it.each([{ mappings: [] }, { mappings: [{ enabled: false, direction: "both" }] }, { mappings: [{ enabled: true, direction: "hubspot_to_wix" }] }])("honors disabled forward mappings before any form provider call (%j)", async ({ mappings }) => {
    m.mappings.mockResolvedValue(mappings);
    m.resolve.mockResolvedValue({ wix: { id: "wix-connection" }, hubspot: { id: "hubspot-connection" }, useDefaultMappings: false });
    expect(await syncWixFormSubmissionToHubSpot("site", { entityId: "submission", fields: { email: "test@example.invalid" } })).toMatchObject({ status: "skipped", reason: "no_enabled_mapping_for_direction" });
    expect(m.find).not.toHaveBeenCalled(); expect(m.create).not.toHaveBeenCalled(); expect(m.ensure).not.toHaveBeenCalled();
  });
  it("extracts array fields, primitive custom values and URL attribution without forwarding structured fields", async () => {
    await syncWixFormSubmissionToHubSpot("site", { entityId: "submission", context: { page: { url: "https://example.invalid/form?utm_source=campaign&utm_medium=email" }, referrer: "https://example.invalid", utm: { utm_campaign: "launch" } }, fields: [
      null, {}, { fieldName: "email", value: " test@example.invalid " }, { name: "givenName", fieldValue: " Ada " },
      { label: "surname", answer: "Lovelace" }, { key: "phone", value: "+123" }, { id: "company", value: "Analytical Engines" },
      { name: "score", value: 0 }, { name: "optedIn", value: false }, { name: "files", value: [{ id: "file" }] }, { name: "empty", value: " " },
    ] });
    expect(m.create.mock.calls[0][0]).toMatchObject({ email: "test@example.invalid", firstname: "Ada", lastname: "Lovelace", phone: "+123", company: "Analytical Engines", wix_form_score: "0", wix_form_optedin: "false", utm_source: "campaign", utm_medium: "email", utm_campaign: "launch" });
    expect(m.create.mock.calls[0][0]).not.toHaveProperty("wix_form_files");
    expect(m.ensure.mock.calls[0][0]).toHaveLength(2);
  });
  it.each([undefined, "bad-email"])("audits invalid form email without provider writes (%s)", async (email) => {
    expect(await syncWixFormSubmissionToHubSpot("site", { entityId: "submission", fields: { email } })).toMatchObject({ reason: "valid_email_required" });
    expect(m.insert).toHaveBeenCalledWith(expect.objectContaining({ outcome: "skipped" })); expect(m.find).not.toHaveBeenCalled();
  });
  it("reports a skipped-event audit storage failure", async () => {
    m.insert.mockResolvedValue({ error: new Error("database unavailable") });
    await expect(syncWixFormSubmissionToHubSpot("site", {})).rejects.toThrow(/record skipped/);
  });
  it("keeps malformed page URLs out of UTM parsing and bounds schema creation", async () => {
    await syncWixFormSubmissionToHubSpot("site", { entityId: "submission", fields: { email: "test@example.invalid" }, page: { url: "invalid-url" } });
    expect(m.create.mock.calls[0][0]).toMatchObject({ landing_page_url: "invalid-url" });
    const fields = { email: "test@example.invalid", ...Object.fromEntries(Array.from({ length: 26 }, (_, i) => [`field${i}`, "value"])) };
    m.ensure.mockClear(); m.create.mockClear();
    await expect(syncWixFormSubmissionToHubSpot("site", { entityId: "submission", fields })).rejects.toThrow(/custom property limit/);
    expect(m.ensure).not.toHaveBeenCalled(); expect(m.create).not.toHaveBeenCalled();
  });
  it("reconciles a remembered destination rather than creating again", async () => {
    m.prepare.mockResolvedValue({ id: "intent", state: "completed", destinationId: "stable-contact", lookupEmail: null });
    await syncWixFormSubmissionToHubSpot("site", { submission: { id: "submission", createdDate: "2026-11-01T10:00:00Z", answers: { email: "test@example.invalid" } } });
    expect(m.get).toHaveBeenCalledWith("stable-contact", [], "hubspot-connection");
    expect(m.remember).toHaveBeenCalled(); expect(m.create).not.toHaveBeenCalled(); expect(m.find).not.toHaveBeenCalled();
  });
  it("does not report success without a destination ID", async () => {
    m.create.mockResolvedValue({});
    await expect(syncWixFormSubmissionToHubSpot("site", { entityId: "submission", fields: { email: "test@example.invalid" } })).rejects.toThrow(/contact ID/);
    expect(m.insert).not.toHaveBeenCalledWith(expect.objectContaining({ outcome: "succeeded" }));
  });
  const linkedSubmission = { submission: { id: "submission", contactId: "wix-contact", createdDate: "2026-11-01T10:00:00Z", submissions: { email: "test@example.invalid" } } };
  it("blocks a form write when source identity lookup is unavailable", async () => {
    m.read.mockResolvedValueOnce({ error: new Error("database unavailable") });
    await expect(syncWixFormSubmissionToHubSpot("site", linkedSubmission)).rejects.toThrow(/form contact identity/);
    expect(m.create).not.toHaveBeenCalled(); expect(m.update).not.toHaveBeenCalled();
  });
  it.each(["unavailable", "already-linked"])("blocks a form destination whose identity is %s", async (mode) => {
    m.find.mockResolvedValue({ id: "stable-contact" });
    m.read.mockResolvedValueOnce({ data: null, error: null }).mockResolvedValueOnce(mode === "unavailable" ? { error: new Error("database unavailable") } : { data: { wix_contact_id: "other-contact" } });
    await expect(syncWixFormSubmissionToHubSpot("site", linkedSubmission)).rejects.toThrow(mode === "unavailable" ? /destination identity/ : /another Wix contact/);
    expect(m.update).not.toHaveBeenCalled(); expect(m.create).not.toHaveBeenCalled();
  });
  it.each(["unavailable", "changed", "write-failed"])("does not audit success if final form link is %s", async (mode) => {
    m.read.mockResolvedValueOnce({ data: null, error: null }).mockResolvedValueOnce(mode === "unavailable" ? { error: new Error("database unavailable") } : { data: mode === "changed" ? { hubspot_contact_id: "other" } : null, error: null });
    if (mode === "write-failed") m.upsert.mockResolvedValue({ error: new Error("database unavailable") });
    await expect(syncWixFormSubmissionToHubSpot("site", linkedSubmission)).rejects.toThrow(/form contact link/i);
    expect(m.create).toHaveBeenCalledTimes(1);
    expect(m.insert).not.toHaveBeenCalledWith(expect.objectContaining({ outcome: "succeeded" }));
  });
  it("reports success-audit failures so the durable event can be retried", async () => {
    m.insert.mockResolvedValue({ error: new Error("database unavailable") });
    await expect(syncWixFormSubmissionToHubSpot("site", { entityId: "submission", fields: { email: "test@example.invalid" } })).rejects.toThrow(/form submission audit/);
  });
  it("preserves provider retry guidance even if recording the failure also throws", async () => {
    m.create.mockRejectedValue(new ProviderApiError("hubspot", 429, "120"));
    m.insert.mockRejectedValue(new Error("database network failure"));
    await expect(syncWixFormSubmissionToHubSpot("site", { entityId: "submission", fields: { email: "test@example.invalid" } })).rejects.toMatchObject({ status: 429, retryAfterSeconds: 120 });
  });
});
