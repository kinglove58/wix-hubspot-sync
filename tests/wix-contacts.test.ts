import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../src/lib/providers/wix/client", () => ({ getWixAccessToken: vi.fn().mockResolvedValue({ access_token: "test-token" }) }));
import { createWixContact, findWixContactByEmail, getWixContact, queryWixContacts, updateWixContact } from "../src/lib/providers/wix/contacts";
import { hubSpotContactToWixInfo, wixContactToHubSpotProperties, mergeWixInfo } from "../src/lib/sync/normalize";

describe("Wix REST v4 contact contract", () => {
  const fetchMock = vi.fn<typeof fetch>();
  const contact = { id: "contact", revision: 7, info: { name: { first: "Ada" }, emails: { items: [{ email: "other@example.invalid" }, { email: "ada@example.invalid", primary: true }] }, phones: { items: [{ phone: "+15555550100", primary: true }] } } };
  beforeEach(() => { vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); });
  afterEach(() => vi.unstubAllGlobals());

  it("normalizes wrapped collections and chooses primary entries", () => {
    expect(wixContactToHubSpotProperties(contact)).toEqual({ firstname: "Ada", email: "ada@example.invalid", phone: "+15555550100" });
    expect(hubSpotContactToWixInfo({ properties: { email: "ada@example.invalid", phone: "+15555550100" } }))
      .toEqual({ emails: { items: [{ email: "ada@example.invalid", primary: true }] }, phones: { items: [{ phone: "+15555550100", primary: true }] } });
  });

  it("preserves secondary contact details during partial mapped updates", () => {
    const patch = { name: { first: "Grace" }, emails: { items: [{ email: "new@example.invalid" }] } };
    const merged = mergeWixInfo(contact.info, patch);
    expect(merged.emails?.items).toEqual([{ email: "new@example.invalid" }, { email: "ada@example.invalid", primary: true }]);
    expect(merged.phones).toBeUndefined(); // Omitted PATCH fields remain unchanged.
    expect(contact.info.name.first).toBe("Ada");
  });

  it("maps supported business, mobile and address fields without inventing geographic codes", () => {
    const info = hubSpotContactToWixInfo({ properties: { jobtitle: "Engineer", mobilephone: "+15555550101", address: "1 Test Street", city: "Example", zip: "12345", country: "United States", state: "California" } });
    expect(info.jobTitle).toBe("Engineer");
    expect(info.phones?.items[0]).toEqual({ phone: "+15555550101", tag: "MOBILE" });
    expect(info.addresses?.items[0].address).toEqual({ addressLine: "1 Test Street", city: "Example", postalCode: "12345" });
    expect(wixContactToHubSpotProperties({ info })).toMatchObject({ jobtitle: "Engineer", mobilephone: "+15555550101", city: "Example", zip: "12345" });
  });

  it("unwraps reads and sends create/update info with the existing revision", async () => {
    fetchMock.mockImplementation(async () => Response.json({ contact }));
    expect(await getWixContact("site", "contact/a")).toEqual(contact);
    expect(fetchMock.mock.calls[0][0]).toBe("https://www.wixapis.com/contacts/v4/contacts/contact%2Fa");
    await createWixContact("site", contact.info);
    await updateWixContact("site", "contact", 7, contact.info);
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({ info: contact.info });
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toEqual({ revision: 7, info: contact.info });
  });

  it("uses offset pagination without cursorPaging", async () => {
    fetchMock.mockResolvedValue(Response.json({ contacts: [] }));
    await queryWixContacts("site", 100);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).query).toEqual({ paging: { limit: 100, offset: 100 }, sort: [{ fieldName: "updatedDate", order: "DESC" }] });
    await expect(queryWixContacts("site", -1)).rejects.toThrow(/offset/);
  });

  it("uses an exact email filter and rejects ambiguous matches", async () => {
    fetchMock.mockResolvedValue(Response.json({ contacts: [contact] }));
    expect(await findWixContactByEmail("site", "ADA@EXAMPLE.INVALID")).toEqual(contact);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).query.filter)
      .toEqual({ "info.emails.email": { $eq: "ada@example.invalid" } });
    fetchMock.mockResolvedValue(Response.json({ contacts: [contact, { ...contact, id: "second" }] }));
    await expect(findWixContactByEmail("site", "ada@example.invalid")).rejects.toThrow(/Ambiguous/);
  });
});
