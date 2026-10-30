import { describe, expect, it } from "vitest";
import { applyNestedMappings } from "../src/lib/sync/nested-mapping";

describe("nested field mapping", () => {
  it("reads nested source values and writes nested target values", () => {
    const result = applyNestedMappings(
      { info: { name: { first: " Ada " } } },
      [{
        sourceField: "info.name.first",
        targetField: "properties.firstname",
        direction: "wix_to_hubspot",
        transform: "trim",
      }],
      "wix_to_hubspot",
    );
    expect(result).toEqual({ properties: { firstname: "Ada" } });
  });

  it("does not create output for missing source paths", () => {
    expect(applyNestedMappings(
      { info: {} },
      [{
        sourceField: "info.name.first",
        targetField: "properties.firstname",
        direction: "wix_to_hubspot",
        transform: "none",
      }],
      "wix_to_hubspot",
    )).toEqual({});
  });
});
