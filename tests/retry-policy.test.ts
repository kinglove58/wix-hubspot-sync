import { describe, expect, it } from "vitest";
import { z } from "zod";
import { retryTransition, isPermanentFailure, rootFailure } from "../src/lib/webhooks/retry-policy";
import { ProviderApiError, ProviderPreflightError } from "../src/lib/providers/api-error";

describe("bounded retry state transitions", () => {
  it.each([[1, 60], [2, 600], [3, 6000], [4, 7200]])("schedules attempt %i with bounded exponential backoff", (attempts, delaySeconds) => {
    expect(retryTransition({ outcome: "failed", attempts })).toEqual({ attempts, delaySeconds, terminal: false });
  });
  it.each(["succeeded", "ignored"] as const)("finishes %s without scheduling another attempt", (outcome) => {
    expect(retryTransition({ outcome, attempts: 1 })).toEqual({ attempts: 1, delaySeconds: null, terminal: false });
  });
  it("does not spend failure budget on contention", () => {
    expect(retryTransition({ outcome: "pending", attempts: 1 })).toEqual({ attempts: 0, delaySeconds: 15, terminal: false });
  });
  it("terminalizes permanent failures immediately and exhausted failures at five attempts", () => {
    expect(retryTransition({ outcome: "failed", attempts: 1, permanent: true }).terminal).toBe(true);
    expect(retryTransition({ outcome: "failed", attempts: 5 })).toEqual({ attempts: 5, delaySeconds: null, terminal: true });
  });
  it("honors provider retry guidance with a 24-hour absolute cap", () => {
    expect(retryTransition({ outcome: "failed", attempts: 1, retryAfterSeconds: 120 }).delaySeconds).toBe(120);
    expect(retryTransition({ outcome: "failed", attempts: 1, retryAfterSeconds: 999999 }).delaySeconds).toBe(86400);
    for (const retryAfterSeconds of [null, undefined, NaN, -5]) expect(retryTransition({ outcome: "failed", attempts: 1, retryAfterSeconds }).delaySeconds).toBe(60);
    expect(() => retryTransition({ outcome: "failed", attempts: 0 })).toThrow();
    expect(() => retryTransition({ outcome: "failed", attempts: 1.5 })).toThrow();
  });
  it("distinguishes permanent input/permission failures from outages and revisions", () => {
    for (const status of [400, 401, 403, 404, 422]) expect(isPermanentFailure(new ProviderApiError("wix", status, null))).toBe(true);
    for (const status of [408, 409, 412, 428, 429, 500, 503]) expect(isPermanentFailure(new ProviderApiError("wix", status, null))).toBe(false);
    const parsed = z.string().safeParse(null);
    expect(isPermanentFailure(parsed.error)).toBe(true);
    expect(isPermanentFailure(new Error("network failure"))).toBe(false);
    const original = new ProviderApiError("hubspot", 429, "120");
    expect(rootFailure(new ProviderPreflightError(new ProviderPreflightError(original)))).toBe(original);
    expect(rootFailure("failure")).toBe("failure");
  });
});
