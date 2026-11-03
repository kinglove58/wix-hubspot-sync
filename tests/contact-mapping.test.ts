import { describe, expect, it } from "vitest";
import { mergedHubSpotInfo, mergedWixProperties } from "../src/lib/sync/contact-mapping";
import type { StoredFieldMapping } from "../src/lib/sync/mapping-repository";

const mapping = (patch: Partial<StoredFieldMapping> = {}): StoredFieldMapping => ({
  id: "mapping", sourceField: "info.jobTitle", targetField: "jobtitle", direction: "both", transform: "trim", enabled: true, ...patch,
});
describe("default and partial custom mappings", () => {
  const wix = { info: { name: { first: "Ada", last: "Lovelace" }, emails: { items: [{ email: "ada@example.invalid", primary: true }] }, jobTitle: " Engineer " } };
  it("keeps default names and email when only a custom field is configured", () => {
    expect(mergedWixProperties(wix, [mapping()])).toEqual({ firstname: "Ada", lastname: "Lovelace", email: "ada@example.invalid", jobtitle: "Engineer" });
    expect(mergedHubSpotInfo({ properties: { email: "ada@example.invalid", firstname: "Ada", jobtitle: " Engineer " } }, [mapping()]))
      .toMatchObject({ name: { first: "Ada" }, emails: { items: [{ email: "ada@example.invalid" }] }, jobTitle: "Engineer" });
  });
  it("preserves defaults when a custom source is missing, null, empty or only whitespace", () => {
    const custom = mapping({ sourceField: "info.customName", targetField: "firstname" });
    for (const value of [undefined, null, "", "  "]) {
      expect(mergedWixProperties({ info: { ...wix.info, customName: value } }, [custom]).firstname).toBe("Ada");
    }
  });
  it("only clears a field when its mapping explicitly opts in", () => {
    const custom = mapping({ sourceField: "info.customName", targetField: "firstname", allowEmpty: true });
    expect(mergedWixProperties({ info: { ...wix.info, customName: null } }, [custom]).firstname).toBe("");
    expect(mergedHubSpotInfo({ properties: { firstname: "Ada", alternate: null } }, [mapping({ sourceField: "info.name.first", targetField: "alternate", allowEmpty: true })]))
      .toEqual({ name: { first: "" } });
  });
  it("does not turn absent HubSpot properties into destructive empty fields", () => {
    expect(mergedHubSpotInfo({ properties: { firstname: null, lastname: "", phone: "  " } }, [])).toEqual({});
  });
  it("respects one-way and disabled overrides without dropping unrelated defaults", () => {
    const custom = mapping({ sourceField: "info.name.first", targetField: "firstname", direction: "hubspot_to_wix" });
    expect(mergedWixProperties(wix, [custom])).toMatchObject({ lastname: "Lovelace", email: "ada@example.invalid" });
    expect(mergedWixProperties(wix, [custom])).not.toHaveProperty("firstname");
    expect(mergedHubSpotInfo({ properties: { firstname: "Ada", email: "ada@example.invalid" } }, [{ ...custom, direction: "wix_to_hubspot" }]))
      .toEqual({ emails: { items: [{ email: "ada@example.invalid", primary: true }] } });
  });
  it("supports an explicitly disabled configuration and rejects complex HubSpot values", () => {
    expect(mergedWixProperties(wix, [], false)).toEqual({});
    expect(mergedHubSpotInfo({ properties: { firstname: "Ada" } }, [], false)).toEqual({});
    expect(mergedWixProperties(wix, [mapping({ enabled: false })])).toEqual({});
    expect(mergedHubSpotInfo({ properties: { firstname: "Ada" } }, [mapping({ enabled: false })])).toEqual({});
    expect(() => mergedWixProperties(wix, [mapping({ sourceField: "info.name" })])).toThrow(/scalar/);
  });
  it("merges custom nested arrays with default contact fields", () => {
    expect(mergedHubSpotInfo({ properties: { email: "a@example.invalid", secondary: "b@example.invalid" } }, [mapping({ sourceField: "info.emails.items.1.email", targetField: "secondary" })]))
      .toEqual({ emails: { items: [{ email: "a@example.invalid", primary: true }, { email: "b@example.invalid" }] } });
  });
});
