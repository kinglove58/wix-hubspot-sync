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

  it("reports missing fields and duplicate targets", () => {
    expect(validateMappings([
      { sourceField: "", targetField: "email", direction: "both", transform: "none" },
      { sourceField: "name", targetField: "email", direction: "both", transform: "none" },
    ])).toEqual([
      "Mapping 1: source field is required",
      "Mapping 2: duplicate target field for direction both",
    ]);
  });
});
