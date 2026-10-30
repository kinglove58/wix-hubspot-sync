import { describe, expect, it } from "vitest";
import type { StoredFieldMapping } from "../src/lib/sync/mapping-repository";
import { mapHubSpotPayloadToWix, mapWixPayloadToHubSpot } from "../src/lib/sync/provider-mapping";

const configured: StoredFieldMapping[] = [
  {
    id: "mapping-1",
    sourceField: "info.name.first",
    targetField: "firstname",
    direction: "both",
    transform: "trim",
    enabled: true,
  },
  {
    id: "mapping-2",
    sourceField: "info.emails.0.email",
    targetField: "email",
    direction: "wix_to_hubspot",
    transform: "lowercase",
    enabled: true,
  },
];

describe("provider mapping adapters", () => {
  it("maps Wix nested contact fields into HubSpot properties", () => {
    expect(mapWixPayloadToHubSpot({
      info: { name: { first: " Ada " }, emails: [{ email: "ADA@EXAMPLE.COM" }] },
    }, configured)).toEqual({ firstname: "Ada", email: "ada@example.com" });
  });

  it("reverses bidirectional mappings from HubSpot to Wix", () => {
    expect(mapHubSpotPayloadToWix({ firstname: " Ada " }, configured))
      .toEqual({ info: { name: { first: "Ada" } } });
  });

  it("does not apply one-way mappings in the reverse direction", () => {
    expect(mapHubSpotPayloadToWix({ email: "ada@example.com" }, configured)).toEqual({});
  });
});
