import { describe, expect, it } from "vitest";
import { applyMappings, transformValue, validateMappings, type FieldMapping } from "../src/lib/sync/mapping";

const mappings: FieldMapping[] = [
  { sourceField: "email", targetField: "email", direction: "both", transform: "trim" },
  { sourceField: "firstName", targetField: "firstname", direction: "wix_to_hubspot", transform: "trim" },
  { sourceField: "lastName", targetField: "lastname", direction: "hubspot_to_wix", transform: "uppercase" },
];

describe("field mapping", () => {
  it("applies only mappings enabled for the requested direction", () => {
    expect(applyMappings(
      { email: " a@example.com ", firstName: " Ana ", lastName: "smith" },
      mappings,
      "wix_to_hubspot",
    )).toEqual({ email: "a@example.com", firstname: "Ana" });
  });

  it("preserves non-string values", () => {
    expect(transformValue(0, "trim")).toBe(0);
    expect(transformValue(null, "lowercase")).toBeNull();
  });

  it("reports missing fields and duplicate destinations", () => {
    expect(validateMappings([
      { sourceField: "", targetField: "email", direction: "both", transform: "none" },
      { sourceField: "name", targetField: "email", direction: "both", transform: "none" },
      { sourceField: "phone", targetField: "email", direction: "wix_to_hubspot", transform: "none" },
    ])).toEqual([
      "Mapping 1: source field is required",
      "Mapping 3: duplicate destination field for the configured sync direction",
    ]);
  });

  it("detects reverse-direction collisions on the Wix destination path", () => {
    expect(validateMappings([
      { sourceField: "info.name.first", targetField: "firstname", direction: "hubspot_to_wix", transform: "none" },
      { sourceField: "info.name.first", targetField: "given_name", direction: "hubspot_to_wix", transform: "none" },
    ])).toEqual([
      "Mapping 2: duplicate destination field for the configured sync direction",
    ]);
  });

  it("detects collisions between bidirectional and one-way mappings", () => {
    expect(validateMappings([
      { sourceField: "info.name.first", targetField: "firstname", direction: "both", transform: "none" },
      { sourceField: "info.name.last", targetField: "firstname", direction: "wix_to_hubspot", transform: "none" },
    ])).toEqual([
      "Mapping 2: duplicate destination field for the configured sync direction",
    ]);
  });
});
