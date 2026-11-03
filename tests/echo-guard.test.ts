import { describe, expect, it } from "vitest";
import { isLikelySyncEcho, isSameSyncEcho } from "../src/lib/sync/echo-guard";

describe("sync echo guard", () => {
  it("normalizes equivalent precision/time zones but never treats invalid dates as echoes", () => {
    expect(isSameSyncEcho("2026-11-03T11:00:00+01:00", "2026-11-03T10:00:00.000Z")).toBe(true);
    expect(isSameSyncEcho("invalid", "invalid")).toBe(false);
    expect(isLikelySyncEcho({ incomingProvider: "wix", lastWrittenBy: "wix", lastSyncedAt: "2026-11-03T10:00:00Z", incomingUpdatedAt: "2026-11-03T10:00:00Z" })).toBe(false);
    expect(isLikelySyncEcho({ incomingProvider: "wix", lastWrittenBy: null, lastSyncedAt: "invalid", incomingUpdatedAt: "invalid" })).toBe(false);
  });
  it("allows real edits immediately after a write and requires provider versions", () => {
    expect(isSameSyncEcho("2026-10-30T12:00:00.001Z", "2026-10-30T12:00:00.000Z")).toBe(false);
    expect(isSameSyncEcho("2026-10-30T12:00:00.000Z", "2026-10-30T12:00:00.000Z")).toBe(true);
    expect(isSameSyncEcho(undefined, "2026-10-30T12:00:00.000Z")).toBe(false);
  });
  it("suppresses an exact opposite-provider echo", () => {
    expect(isLikelySyncEcho({
      incomingProvider: "hubspot",
      lastWrittenBy: "wix",
      lastSyncedAt: "2026-10-30T12:00:00.000Z",
      incomingUpdatedAt: "2026-10-30T12:00:00.000Z",
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
