import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { isLikelySyncEcho } from "../src/lib/sync/echo-guard";

describe("isLikelySyncEcho", () => {
  it("suppresses a matching opposite-provider timestamp", () => {
    expect(isLikelySyncEcho({
      incomingProvider: "hubspot",
      lastWrittenBy: "wix",
      lastWrittenTargetUpdatedAt: "2026-10-30T10:00:00.000Z",
      incomingUpdatedAt: "2026-10-30T10:00:05.000Z",
    })).toBe(true);
  });

  it("does not suppress a genuinely newer provider update", () => {
    expect(isLikelySyncEcho({
      incomingProvider: "hubspot",
      lastWrittenBy: "wix",
      lastWrittenTargetUpdatedAt: "2026-10-30T10:00:00.000Z",
      incomingUpdatedAt: "2026-10-30T10:02:00.000Z",
    })).toBe(false);
  });

  it("does not suppress events from the provider that originated the last sync", () => {
    expect(isLikelySyncEcho({
      incomingProvider: "wix",
      lastWrittenBy: "wix",
      lastWrittenTargetUpdatedAt: "2026-10-30T10:00:00.000Z",
      incomingUpdatedAt: "2026-10-30T10:00:01.000Z",
    })).toBe(false);
  });

  it("fails open when either timestamp is missing or invalid", () => {
    expect(isLikelySyncEcho({
      incomingProvider: "wix",
      lastWrittenBy: "hubspot",
      lastWrittenTargetUpdatedAt: null,
      incomingUpdatedAt: "2026-10-30T10:00:01.000Z",
    })).toBe(false);
    expect(isLikelySyncEcho({
      incomingProvider: "wix",
      lastWrittenBy: "hubspot",
      lastWrittenTargetUpdatedAt: "not-a-date",
      incomingUpdatedAt: "2026-10-30T10:00:01.000Z",
    })).toBe(false);
  });
});
