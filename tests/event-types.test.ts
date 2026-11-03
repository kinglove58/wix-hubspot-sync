import { describe, expect, it } from "vitest";
import { isHubSpotContactEvent, isWixContactEvent } from "../src/lib/webhooks/event-types";

describe("documented provider event types", () => {
  it("accepts classic and generic HubSpot contact events only for the contact object type", () => {
    expect(isHubSpotContactEvent("contact.creation", {})).toBe(true);
    expect(isHubSpotContactEvent("object.propertyChange", { objectTypeId: "0-1" })).toBe(true);
    expect(isHubSpotContactEvent("object.creation", { objectTypeId: "0-2" })).toBe(false);
    expect(isHubSpotContactEvent("object.creation", {})).toBe(false);
    expect(isHubSpotContactEvent("contact.propertyChange", { objectTypeId: "0-2" })).toBe(false);
    expect(isHubSpotContactEvent("contact.deletion", {})).toBe(false);
  });
  it("rejects guessed Wix identifiers", () => {
    expect(isWixContactEvent("wix.contacts.v4.contact_created")).toBe(true);
    expect(isWixContactEvent("wix.contacts.v4.contact_updated")).toBe(true);
    expect(isWixContactEvent("other.contact_created")).toBe(false);
    expect(isWixContactEvent("contact.created")).toBe(false);
  });
});
