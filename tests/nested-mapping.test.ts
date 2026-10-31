import { describe, expect, it } from "vitest";
import { applyNestedMappings } from "../src/lib/sync/nested-mapping";
import type { FieldMapping } from "../src/lib/sync/mapping";

describe("nested field mapping", () => {
  it("reads nested source values and writes nested target values", () => {
    const result = applyNestedMappings(
      { info: { name: { first: " Ada " } } },
      [{ sourceField: "info.name.first", targetField: "properties.firstname", direction: "wix_to_hubspot", transform: "trim" }],
      "wix_to_hubspot",
    );
    expect(result).toEqual({ properties: { firstname: "Ada" } });
  });

  it("maps Wix email arrays into a HubSpot property and back into an array", () => {
    const mappings: FieldMapping[] = [
      { sourceField: "info.emails.0.email", targetField: "email", direction: "wix_to_hubspot", transform: "lowercase" },
      { sourceField: "email", targetField: "info.emails.0.email", direction: "hubspot_to_wix", transform: "trim" },
    ];
    expect(applyNestedMappings(
      { info: { emails: [{ email: "ADA@EXAMPLE.COM" }] } }, mappings, "wix_to_hubspot",
    )).toEqual({ email: "ada@example.com" });
    expect(applyNestedMappings(
      { email: " ada@example.com " }, mappings, "hubspot_to_wix",
    )).toEqual({ info: { emails: [{ email: "ada@example.com" }] } });
  });

  it("ignores prototype-polluting target paths", () => {
    const mappings: FieldMapping[] = [
      { sourceField: "name", targetField: "__proto__.polluted", direction: "both", transform: "none" },
    ];
    expect(applyNestedMappings({ name: "bad" }, mappings, "wix_to_hubspot")).toEqual({});
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("does not create output for missing source paths", () => {
    expect(applyNestedMappings(
      { info: {} },
      [{ sourceField: "info.name.first", targetField: "properties.firstname", direction: "wix_to_hubspot", transform: "none" }],
      "wix_to_hubspot",
    )).toEqual({});
  });
});
