import { describe, expect, it } from "vitest";
import { applyTransform, mapProperties, validateMappings } from "./mapping";
import type { FieldMapping } from "./types";

const mappings: FieldMapping[] = [
  {
    wixField: "firstName",
    hubspotProperty: "firstname",
    direction: "bidirectional",
    transform: "trim",
    enabled: true,
  },
  {
    wixField: "email",
    hubspotProperty: "email",
    direction: "wix_to_hubspot",
    transform: "lowercase",
    enabled: true,
  },
  {
    wixField: "ignored",
    hubspotProperty: "ignored_property",
    direction: "bidirectional",
    enabled: false,
  },
];

describe("applyTransform", () => {
  it("trims strings", () => expect(applyTransform("  Ada  ", "trim")).toBe("Ada"));
  it("lowercases strings", () => expect(applyTransform("ADA@EXAMPLE.COM", "lowercase")).toBe("ada@example.com"));
  it("leaves non-string values unchanged", () => expect(applyTransform(12, "uppercase")).toBe(12));
  it("preserves null", () => expect(applyTransform(null, "trim")).toBeNull());
});

describe("mapProperties", () => {
  it("maps Wix properties into HubSpot properties", () => {
    expect(mapProperties(
      { firstName: " Ada ", email: "ADA@EXAMPLE.COM", ignored: "x" },
      mappings,
      "wix_to_hubspot",
    )).toEqual({ firstname: "Ada", email: "ada@example.com" });
  });

  it("maps bidirectional fields back to Wix", () => {
    expect(mapProperties({ firstname: " Ada " }, mappings, "hubspot_to_wix"))
      .toEqual({ firstName: "Ada" });
  });
});

describe("validateMappings", () => {
  it("accepts a valid mapping configuration", () => {
    expect(validateMappings(mappings)).toEqual([]);
  });

  it("rejects empty required fields", () => {
    expect(validateMappings([{
      wixField: "",
      hubspotProperty: "",
      direction: "bidirectional",
      enabled: true,
    }])).toHaveLength(2);
  });
});
