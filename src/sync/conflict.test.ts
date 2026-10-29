import { describe, expect, it } from "vitest";
import { decideConflict } from "./conflict";

describe("decideConflict", () => {
  it("returns no change when neither side changed", () => {
    expect(decideConflict({
      wixUpdatedAt: null,
      hubspotUpdatedAt: null,
      wixChangedSinceLastSync: false,
      hubspotChangedSinceLastSync: false,
    })).toEqual({ winner: "none", reason: "no_change" });
  });

  it("chooses the only side that changed", () => {
    expect(decideConflict({
      wixUpdatedAt: null,
      hubspotUpdatedAt: null,
      wixChangedSinceLastSync: true,
      hubspotChangedSinceLastSync: false,
    })).toEqual({ winner: "wix", reason: "only_one_side_changed" });
  });

  it("chooses the side with the newer timestamp when both changed", () => {
    expect(decideConflict({
      wixUpdatedAt: "2026-01-01T10:00:00.000Z",
      hubspotUpdatedAt: "2026-01-01T11:00:00.000Z",
      wixChangedSinceLastSync: true,
      hubspotChangedSinceLastSync: true,
    })).toEqual({ winner: "hubspot", reason: "newer_source_timestamp" });
  });

  it("uses a deterministic HubSpot tie-break when timestamps are equal", () => {
    expect(decideConflict({
      wixUpdatedAt: "2026-01-01T10:00:00.000Z",
      hubspotUpdatedAt: "2026-01-01T10:00:00.000Z",
      wixChangedSinceLastSync: true,
      hubspotChangedSinceLastSync: true,
    })).toEqual({ winner: "hubspot", reason: "deterministic_tie_break" });
  });
});
