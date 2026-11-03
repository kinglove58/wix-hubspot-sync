import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
const mocks = vi.hoisted(() => ({ admin: vi.fn() }));
vi.mock("../src/lib/supabase/admin", () => ({ getSupabaseAdmin: mocks.admin }));
import { finishWebhookEvent, stableIdempotencyKey, type VerifiedWebhookEvent } from "../src/lib/webhooks/event-store";

const event: VerifiedWebhookEvent = {
  provider: "hubspot", eventId: "42", eventType: "contact.propertyChange", correlationId: "1",
  payload: { portalId: 100, objectId: 1, occurredAt: 12345, attemptNumber: 0, propertyName: "email", propertyValue: "test@example.invalid" },
};

describe("event identity", () => {
  it("uses locale-independent fallback identity for mixed-case and Unicode keys", () => {
    const input = { ...event, eventId: undefined, payload: { portalId: 100, nested: { "ä": 1, a: 2, Z: 3 } } };
    const canonical = { provider: "hubspot", eventType: input.eventType, correlationId: "1", payload: { nested: { Z: 3, a: 2, "ä": 1 }, portalId: 100 } };
    const expected = createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
    expect(stableIdempotencyKey(input)).toBe(`hubspot:100:sha256:${expected}`);
  });
  it("canonicalizes fallback identity across key order and delivery attempts", () => {
    const first = { ...event, eventId: undefined, payload: { portalId: 100, attemptNumber: 0, nested: { b: 2, a: 1 } } };
    const retry = { ...first, payload: { nested: { a: 1, b: 2 }, attemptNumber: 4, portalId: 100 } };
    expect(stableIdempotencyKey(first)).toBe(stableIdempotencyKey(retry));
    expect(stableIdempotencyKey({ ...retry, payload: { ...retry.payload, portalId: 200 } })).not.toBe(stableIdempotencyKey(first));
  });
  it("deduplicates redelivery but separates portals and distinct events", () => {
    const key = stableIdempotencyKey(event);
    expect(stableIdempotencyKey({ ...event, payload: { ...event.payload, attemptNumber: 3 } })).toBe(key);
    expect(stableIdempotencyKey({ ...event, payload: { ...event.payload, portalId: 200 } })).not.toBe(key);
    expect(stableIdempotencyKey({ ...event, payload: { ...event.payload, occurredAt: 54321 } })).not.toBe(key);
    expect(stableIdempotencyKey({ ...event, correlationId: "2" })).not.toBe(key);
  });
  it("requires account identity and keeps contact values out of plaintext keys", () => {
    expect(() => stableIdempotencyKey({ ...event, payload: {} })).toThrow(/account/);
    expect(stableIdempotencyKey(event)).not.toContain("test@example.invalid");
  });
});

describe("worker completion fencing", () => {
  beforeEach(() => vi.clearAllMocks());
  it("refuses completion without an owned attempt", async () => {
    await expect(finishWebhookEvent("event", "succeeded")).rejects.toThrow(/lease/);
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("never completes a newer worker's claim", async () => {
    const read = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { attempts: 1 }, error: null }) };
    const write = { update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) };
    mocks.admin.mockReturnValue({ from: vi.fn().mockReturnValueOnce(read).mockReturnValueOnce(write) });
    await expect(finishWebhookEvent("event", "succeeded", undefined, 1)).rejects.toThrow(/lease lost/);
    expect(write.eq).toHaveBeenCalledWith("lease_version", 1);
    expect(write.eq).toHaveBeenCalledWith("status", "processing");
  });
  it("honors Retry-After when scheduling a failed attempt", async () => {
    const read = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { attempts: 1 }, error: null }) };
    const write = { update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { id: "event" }, error: null }) };
    mocks.admin.mockReturnValue({ from: vi.fn().mockReturnValueOnce(read).mockReturnValueOnce(write) });
    const before = Date.now();
    await finishWebhookEvent("event", "failed", "HUBSPOT_HTTP_429", 1, 120);
    const values = write.update.mock.calls[0][0] as { next_attempt_at: string };
    expect(Date.parse(values.next_attempt_at)).toBeGreaterThanOrEqual(before + 120_000);
  });

  it("defers lock contention without spending retry budget or reusing a lease token", async () => {
    const read = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { attempts: 2 }, error: null }) };
    const write = { update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { id: "event" }, error: null }) };
    mocks.admin.mockReturnValue({ from: vi.fn().mockReturnValueOnce(read).mockReturnValueOnce(write) });
    await finishWebhookEvent("event", "pending", "INTEGRATION_BUSY", 7);
    expect(write.eq).toHaveBeenCalledWith("lease_version", 7);
    expect(write.update).toHaveBeenCalledWith(expect.objectContaining({ status: "pending", attempts: 1, processed_at: null }));
  });
});
