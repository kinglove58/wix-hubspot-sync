import { describe, expect, it } from "vitest";
import { wixContactToHubSpotProperties } from "../src/lib/sync/normalize";
import type { WixContact } from "../src/lib/providers/wix/contacts";

describe("wixContactToHubSpotProperties", () => {
  it("reads nested v4 email and phone item collections", () => {
    const result = wixContactToHubSpotProperties({
      id: "wix-1",
      info: {
        name: { first: "Ada", last: "Lovelace" },
        emails: { items: [
          { tag: "OTHER", email: "other@example.com" },
          { tag: "MAIN", email: "ada@example.com", primary: true },
        ] },
        phones: { items: [{ tag: "MAIN", phone: "+2348000000000" }] },
        company: "Analytical Engines",
      },
    });
    expect(result).toEqual({
      email: "ada@example.com",
      firstname: "Ada",
      lastname: "Lovelace",
      phone: "+2348000000000",
      company: "Analytical Engines",
    });
  });

  it("supports array-based contact collections and safely omits absent fields", () => {
    // Legacy inputs are outside the current REST type but remain safe to normalize.
    expect(wixContactToHubSpotProperties({
      info: { emails: [{ email: "first@example.com" }] },
    } as unknown as WixContact)).toEqual({ email: "first@example.com" });
  });
});
