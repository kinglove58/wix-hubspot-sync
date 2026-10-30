import { describe, expect, it } from "vitest";
import { isLikelySyncEcho } from "../src/lib/sync/echo-guard";

describe("sync echo guard", () => {
  it("suppresses a recent opposite-provider echo", () => {
    expect(isLikelySyncEcho({
      incomingProvider: "hubspot",
      lastWrittenBy: "wix",
      lastSyncedAt: "2026-10-30T12:00:00.000Z",
      incomingUpdatedAt: "2026-10-30T12:00:10.000Z",
    })).toBe(true);
  });

  it("does not suppress a newer genuine update", () => {
    expect(isLikelySyncEcho({
      incomingProvider: "hubspot",
      lastWrittenBy: "wix",
      lastSyncedAt: "2026-10-30T12:00:00.000Z",
      incomingUpdatedAt: "2026-10-30T12:01:00.000Z",
    })).toBe(false);
  });

  it("does not suppress events without reliable timestamps", () => {
    expect(isLikelySyncEcho({
      incomingProvider: "hubspot",
      lastWrittenBy: "wix",
      lastSyncedAt: null,
      incomingUpdatedAt: null,
    })).toBe(false);
  });
});
