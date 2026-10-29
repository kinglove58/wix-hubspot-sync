import { describe, expect, it } from "vitest";
import { resolveConflict } from "../src/lib/sync/conflict";

describe("resolveConflict", () => {
  it("chooses the provider with the more recent timestamp", () => {
    expect(resolveConflict(
      { provider: "wix", externalId: "w1", updatedAt: "2026-10-01T10:00:00.000Z" },
      { provider: "hubspot", externalId: "h1", updatedAt: "2026-10-01T11:00:00.000Z" },
    ).winner).toBe("hubspot");
  });

  it("uses a stable tie-break when timestamps match", () => {
    expect(resolveConflict(
      { provider: "wix", externalId: "w1", updatedAt: "2026-10-01T10:00:00.000Z" },
      { provider: "hubspot", externalId: "h1", updatedAt: "2026-10-01T10:00:00.000Z" },
    ).winner).toBe("hubspot");
  });

  it("uses the valid timestamp if only one exists", () => {
    expect(resolveConflict(
      { provider: "wix", externalId: "w1", updatedAt: "2026-10-01T10:00:00.000Z" },
      { provider: "hubspot", externalId: "h1", updatedAt: "not-a-date" },
    ).winner).toBe("wix");
  });
});
